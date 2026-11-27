"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";

type RequestStatus = "Awaiting client action" | "Reminder sent";
type Locale = "en" | "fr" | "ar";
type Screen = "landing" | "plans" | "checkout" | "auth" | "app";
type AuthMode = "signup" | "login" | "reset";
type BillingCycle = "monthly" | "yearly";
type Greeting = "Good morning" | "Good afternoon" | "Good evening";
type PlanId = "starter" | "pro";
type DocumentRequest = {
  id: number;
  client: string;
  service: string;
  progress: number;
  status: RequestStatus;
  detail?: string;
};
type DocumentCategory = "bank_statements" | "invoices" | "tax_forms" | "payroll" | "receipts" | "other";
type ClientDocument = {
  id: string;
  clientId: string;
  uploadedBy: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
  createdAt: string;
};
// Shape of a row coming from the database. `category` is optional because
// older databases don't have that column yet (fallback query omits it).
type StoredClientDocument = {
  id: string;
  client_id: string | number;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
  category?: string | null;
  created_at: string;
};
type Client = {
  id: string | null;
  name: string;
  company: string;
  email: string;
  phone: string;
  documentSet: string;
  requests: number;
  color: string;
};
type NotificationItem = {
  id: string;
  clientId: string;
  documentId: string | null;
  clientName: string;
  clientCompany: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};
type StoredNotification = {
  id: string;
  client_id: string | number;
  related_document_id: string | null;
  title: string;
  body: string;
  created_at: string;
};
type ClientMessage = {
  id: string;
  clientId: string;
  senderId: string;
  senderRole: "manager" | "accountant" | "client";
  body: string;
  createdAt: string;
  managerReadAt: string | null;
  clientReadAt: string | null;
  replyToMessageId: string | null;
  forwardedFromMessageId: string | null;
  pinnedAt: string | null;
};
type StoredClientMessage = {
  id: string;
  client_id: string | number;
  sender_id: string;
  sender_role: "manager" | "accountant" | "client";
  body: string;
  created_at: string;
  manager_read_at: string | null;
  client_read_at: string | null;
  reply_to_message_id: string | null;
  forwarded_from_message_id: string | null;
  pinned_at: string | null;
};
type View = "Dashboard" | "Clients" | "Messages" | "Documents" | "Templates" | "Settings";

const phoneCountries = getCountries()
  .map((country) => ({ country, callingCode: getCountryCallingCode(country) }))
  .sort((a, b) => b.callingCode.length - a.callingCode.length);

const documentCategoryOptions: { value: DocumentCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bank_statements", label: "Bank Statements" },
  { value: "invoices", label: "Invoices" },
  { value: "tax_forms", label: "Tax Forms" },
  { value: "payroll", label: "Payroll" },
  { value: "receipts", label: "Receipts" },
  { value: "other", label: "Other" },
];
const documentCategoryLabels: Record<DocumentCategory, string> = {
  bank_statements: "Bank Statements",
  invoices: "Invoices",
  tax_forms: "Tax Forms",
  payroll: "Payroll",
  receipts: "Receipts",
  other: "Other",
};

function flagForCountry(country: CountryCode) {
  return String.fromCodePoint(...Array.from(country, (letter) => 127397 + letter.charCodeAt(0)));
}

function isStoredNotification(value: unknown): value is StoredNotification {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && (typeof record.client_id === "string" || typeof record.client_id === "number")
    && (typeof record.related_document_id === "string" || record.related_document_id === null)
    && typeof record.title === "string"
    && typeof record.body === "string"
    && typeof record.created_at === "string";
}

function notificationFromRecord(
  record: StoredNotification,
  clientsById: Map<string, Client>,
  readIds: Set<string>,
): NotificationItem | null {
  const client = clientsById.get(String(record.client_id));
  if (!client) return null;
  return {
    id: record.id,
    clientId: String(record.client_id),
    documentId: record.related_document_id,
    clientName: client.name,
    clientCompany: client.company,
    title: record.title,
    body: record.body,
    createdAt: record.created_at,
    read: readIds.has(record.id),
  };
}

const clientMessageColumns = "id, client_id, sender_id, sender_role, body, created_at, manager_read_at, client_read_at, reply_to_message_id, forwarded_from_message_id, pinned_at";
const baseClientMessageColumns = "id, client_id, sender_id, sender_role, body, created_at, manager_read_at, client_read_at";

function isStoredClientMessage(value: unknown): value is StoredClientMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && (typeof record.client_id === "string" || typeof record.client_id === "number")
    && typeof record.sender_id === "string"
    && (record.sender_role === "manager" || record.sender_role === "accountant" || record.sender_role === "client")
    && typeof record.body === "string"
    && typeof record.created_at === "string"
    && (typeof record.manager_read_at === "string" || record.manager_read_at === null)
    && (typeof record.client_read_at === "string" || record.client_read_at === null)
    && (record.reply_to_message_id === undefined || typeof record.reply_to_message_id === "string" || record.reply_to_message_id === null)
    && (record.forwarded_from_message_id === undefined || typeof record.forwarded_from_message_id === "string" || record.forwarded_from_message_id === null)
    && (record.pinned_at === undefined || typeof record.pinned_at === "string" || record.pinned_at === null);
}

function messageFromRecord(record: StoredClientMessage): ClientMessage {
  return {
    id: record.id,
    clientId: String(record.client_id),
    senderId: record.sender_id,
    senderRole: record.sender_role,
    body: record.body,
    createdAt: record.created_at,
    managerReadAt: record.manager_read_at,
    clientReadAt: record.client_read_at,
    replyToMessageId: record.reply_to_message_id ?? null,
    forwardedFromMessageId: record.forwarded_from_message_id ?? null,
    pinnedAt: record.pinned_at ?? null,
  };
}

function isMissingInteractiveMessageColumns(error: { message: string }) {
  return /reply_to_message_id|forwarded_from_message_id|pinned_at/i.test(error.message)
    && /column|schema cache|does not exist|not found/i.test(error.message);
}

function documentCategoryFromDatabase(category: string): DocumentCategory {
  return category === "Other" ? "other" : documentCategoryLabels[category as DocumentCategory] ? category as DocumentCategory : "other";
}

function isMissingClientDocumentCategory(error: { code?: string; message: string }) {
  return error.code === "42703"
    || error.code === "PGRST204"
    || (/category/i.test(error.message)
      && /(column|schema cache)/i.test(error.message)
      && /(does not exist|could not find|not found)/i.test(error.message));
}

function documentFileType(fileName: string, mimeType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf" || mimeType === "application/pdf") return "PDF";
  if (["xls", "xlsx", "csv"].includes(extension ?? "")) return "Excel";
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(extension ?? "") || mimeType.startsWith("image/")) return "Image";
  if (["doc", "docx"].includes(extension ?? "")) return "Word";
  return extension?.toUpperCase() || "File";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readNotificationIds(userId: string) {
  const stored = window.localStorage.getItem(`autolyn-read-notifications-${userId}`);
  if (!stored) return new Set<string>();
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
    throw new Error("Saved notification read state is invalid.");
  }
  return new Set(parsed);
}

function formatRelativeTime(timestamp: string, locale: Locale) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  const value = elapsedSeconds < 60
    ? Math.max(1, elapsedSeconds)
    : elapsedSeconds < 3600
      ? Math.floor(elapsedSeconds / 60)
      : elapsedSeconds < 86400
        ? Math.floor(elapsedSeconds / 3600)
        : Math.floor(elapsedSeconds / 86400);
  const unit: Intl.RelativeTimeFormatUnit = elapsedSeconds < 60
    ? "second"
    : elapsedSeconds < 3600
      ? "minute"
      : elapsedSeconds < 86400
        ? "hour"
        : "day";
  const localeTag = locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en";
  return new Intl.RelativeTimeFormat(localeTag, { numeric: "auto", style: "narrow" }).format(-value, unit);
}

function recognizePhoneCountry(value: string, selectedCountry: CountryCode) {
  const trimmed = value.trim();
  const internationalNumber = trimmed.startsWith("00")
    ? `+${trimmed.slice(2)}`
    : trimmed;
  // Only auto-detect once enough characters are typed/pasted, so typing "+1" doesn't wipe the field.
  if (!internationalNumber.startsWith("+") || internationalNumber.length < 7) {
    return { country: selectedCountry, phone: value };
  }

  const parsedNumber = parsePhoneNumberFromString(internationalNumber, { extract: false });
  if (parsedNumber?.country) {
    return { country: parsedNumber.country, phone: parsedNumber.formatNational() };
  }

  const digits = internationalNumber.replace(/\D/g, "");
  const matches = phoneCountries.filter(({ callingCode }) => digits.startsWith(callingCode));
  const match = matches.find(({ country }) => country === selectedCountry)
    ?? matches.find(({ country }) => country === "US")
    ?? matches[0];
  if (!match) return { country: selectedCountry, phone: value };

  return {
    country: match.country,
    phone: digits.slice(match.callingCode.length),
  };
}

const translations: Record<Exclude<Locale, "en">, Record<string, string>> = {
  fr: {
    "Main navigation": "Navigation principale", WORKSPACE: "ESPACE DE TRAVAIL", Dashboard: "Tableau de bord", Clients: "Clients", Messages: "Messages",
    Templates: "Modèles", Settings: "Paramètres", "Free workspace": "Espace gratuit", "4 of 10 client spaces used": "4 espaces clients sur 10 utilisés",
    "Manage plan": "Gérer l’offre", "Workspace owner": "Responsable de l’espace", Workspace: "Espace de travail", "client spaces used": "espaces clients utilisés",
    "Search clients...": "Rechercher des clients...", Search: "Rechercher", Notifications: "Notifications", "Mark all as read": "Tout marquer comme lu",
    Filters: "Filtres",
    Documents: "Documents", "Browse and manage files shared by your clients.": "Parcourez et gérez les fichiers partagés par vos clients.",
    "Filter documents by client": "Filtrer les documents par client", "Filter documents by category": "Filtrer les documents par catégorie",
    "Documents uploaded by your clients will appear here.": "Les documents déposés par vos clients apparaîtront ici.",
    "View client uploads": "Voir les fichiers du client", clients: "clients",
    "Client conversations": "Conversations clients", "Search conversations...": "Rechercher des conversations...",
    "Select a conversation": "Sélectionnez une conversation", "No messages yet. Send the first message.": "Aucun message. Envoyez le premier.",
    "Write a message...": "Écrire un message...", Send: "Envoyer", "Could not load messages.": "Impossible de charger les messages.",
    Retry: "Réessayer",
    "Could not send this message.": "Impossible d’envoyer ce message.", "Could not mark messages as read.": "Impossible de marquer les messages comme lus.",
    "Could not update this message.": "Impossible de modifier ce message.", "Could not delete this message.": "Impossible de supprimer ce message.",
    "Delete this message?": "Supprimer ce message ?", "Confirm delete?": "Confirmer la suppression ?", "Confirm delete message": "Confirmer la suppression du message",
    "Message actions": "Actions du message", "Reply, forward, and pin require the latest Supabase Messages migration.": "Répondre, transférer et épingler nécessitent la dernière migration Supabase des messages.", "Message info": "Infos du message", Reply: "Répondre", Copy: "Copier", Forward: "Transférer", Pin: "Épingler", Unpin: "Désépingler", Pinned: "Épinglé", "Forwarded message": "Message transféré", "Replying to": "En réponse à", "Read by client": "Lu par le client", "Read by you": "Lu par vous", "Not read yet": "Pas encore lu", "Forward to": "Transférer à", "Choose a client": "Choisir un client", Copied: "Copié", Forwarded: "Transféré", "Sent at": "Envoyé le", "Read at": "Lu le", "Original message unavailable": "Message d’origine indisponible",
    "Edit message": "Modifier le message", "Delete message": "Supprimer le message",
    Edit: "Modifier", Save: "Enregistrer", "Saving…": "Enregistrement…", "Deleting…": "Suppression…",
    "Messages must be 4,000 characters or fewer.": "Les messages ne peuvent pas dépasser 4 000 caractères.",
    All: "Tout", "All Clients": "Tous les clients", "Bank Statements": "Relevés bancaires",
    Invoices: "Factures", "Tax Forms": "Formulaires fiscaux", Payroll: "Paie", Receipts: "Reçus", Other: "Autre",
    "Search documents...": "Rechercher des documents...", "Upload document": "Téléverser un document",
    "Select a client": "Sélectionner un client", "No documents found": "Aucun document trouvé",
    "Could not load documents.": "Impossible de charger les documents.", "Document uploaded successfully.": "Document téléversé.",
    "Share link copied. It expires in 1 hour.": "Lien copié. Il expire dans une heure.",
    "Could not copy the share link.": "Impossible de copier le lien de partage.",
    Uploads: "Dépôts", Share: "Partager", Delete: "Supprimer", "Delete client": "Supprimer le client",
    "Are you sure you want to delete": "Voulez-vous vraiment supprimer",
    "This will also permanently remove all their uploaded documents.": "Tous ses documents téléversés seront également supprimés définitivement.",
    "You are all caught up!": "Vous êtes à jour !", "Loading notifications…": "Chargement des notifications…",
    "Clients documents will show here.": "Les documents de vos clients s’afficheront ici.",
    "New document received": "Nouveau document reçu",
    "The clients uploads will appear here.": "Les fichiers déposés par vos clients apparaîtront ici.", "YOUR ACCOUNTING WORKSPACE": "VOTRE ESPACE COMPTABLE",
    "Good morning": "Bonjour", "Good afternoon": "Bon après-midi", "Good evening": "Bonsoir", "Here’s what’s happening with your client documents.": "Voici l’activité récente de vos documents clients.",
    "New request": "Nouvelle demande", "Workspace overview": "Aperçu de l’espace", "Active requests": "Demandes actives",
    "from last month": "par rapport au mois dernier", "Pending uploads": "Documents en attente", Across: "Pour",
    "4 clients": "4 clients", "Documents received": "Documents reçus", "this month": "ce mois-ci",
    "Waiting on clients": "En attente des clients", "Needs your attention": "À traiter", "Client document requests": "Demandes de documents clients",
    "Keep your client work moving forward.": "Faites avancer le travail de vos clients.", "View all": "Tout voir",
    "Document activity": "Activité des documents", "Reminder sent": "Rappel envoyé",
    "Awaiting client action": "En attente du client", "complete": "terminé", "More options for": "Plus d’options pour",
    "Open": "Ouvrir", "No requests match": "Aucune demande ne correspond à", "Review file": "Examiner le fichier",
    "No uploads match": "Aucun document ne correspond à", "Showing": "Affichage de", "active requests": "demandes actives",
    "recent uploads": "documents récents", "See all activity": "Voir toute l’activité", "Recent activity": "Activité récente",
    "The latest updates from your workspace.": "Les dernières nouveautés de votre espace.", "More activity options": "Plus d’options d’activité",
    "uploaded": "a téléversé", "12 minutes ago": "il y a 12 minutes", "Reminder sent to": "Rappel envoyé à",
    "1 hour ago": "il y a 1 heure", "completed": "a terminé", "Payroll documents": "Documents de paie", Yesterday: "Hier",
    "A LITTLE TIP": "PETIT CONSEIL", "Less chasing,": "Moins de relances,", "more accounting.": "plus de comptabilité.",
    "Set up a request template once and reuse it for every client.": "Créez un modèle de demande et réutilisez-le pour chaque client.",
    "Explore templates": "Découvrir les modèles", "YOUR WORKSPACE": "VOTRE ESPACE", "Manage your client relationships and their documents.": "Gérez vos clients et leurs documents.",
    "Your clients": "Vos clients", "client workspaces": "espaces clients", request: "demande", requests: "demandes",
    "active request": "demande active",
    "SAVE TIME ON REPEAT WORK": "GAGNEZ DU TEMPS AU QUOTIDIEN", "Request templates": "Modèles de demande",
    "Start with a template and tailor document requests to each client.": "Partez d’un modèle et adaptez les demandes à chaque client.",
    "Use template": "Utiliser le modèle", "WORKSPACE PREFERENCES": "PRÉFÉRENCES DE L’ESPACE",
    "Manage your CountaDocs workspace and profile.": "Gérez votre espace CountaDocs et votre profil.", "Workspace profile": "Profil de l’espace",
    "Your accounting practice details.": "Les informations de votre cabinet comptable.", "Workspace name": "Nom de l’espace",
    "Enter your workspace name": "Saisissez le nom de votre espace",
    "Workspace name saved in this demo.": "Nom de l’espace enregistré dans cette démo.",
    "Owner name": "Nom du responsable", "Email address": "Adresse e-mail", "Save changes": "Enregistrer",
    "Changes saved": "Modifications enregistrées", "Help & support": "Aide et assistance", "Simple, secure client document collection.": "La collecte de documents clients, simple et sécurisée.",
    "Create a document request": "Créer une demande de documents", "Choose a client and the documents you need from them.": "Choisissez un client et les documents à demander.",
    "Client name": "Nom du client", "e.g. Acme Accounting": "Ex. Cabinet ABC", "Request template": "Modèle de demande",
    "Choose a template...": "Choisir un modèle...", "Custom document request": "Demande de documents personnalisée",
    "Enter a client name and choose a request type.": "Saisissez le nom du client et choisissez un type de demande.",
    Cancel: "Annuler", "Create request": "Créer la demande", "Demo workspace · client records and requests stay in this page only.": "Espace de démonstration · les clients et les demandes restent sur cette page.",
    "Close dialog": "Fermer", "View": "Voir",
    "Open profile settings": "Ouvrir les paramètres du profil", active: "en cours",
    "Bank statement": "Relevé bancaire",
    "Expense receipts": "Justificatifs de frais", "Today, 10:42 AM": "Aujourd’hui, 10 h 42",
    "Today, 09:18 AM": "Aujourd’hui, 9 h 18", "Yesterday, 04:35 PM": "Hier, 16 h 35",
    "Monthly bookkeeping": "Comptabilité mensuelle", "Year-End Tax": "Déclaration fiscale annuelle",
    "Monthly Payroll": "Paie mensuelle", "New Client Onboarding": "Intégration d’un nouveau client",
    "Year-end tax preparation": "Préparation fiscale annuelle", "Monthly payroll": "Gestion mensuelle de la paie",
    "New client onboarding": "Intégration d’un nouveau client", "Bank statements, receipts, invoices, and expense reports.": "Relevés bancaires, reçus, factures et notes de frais.",
    "Financial statements, tax forms, and supporting records.": "États financiers, formulaires fiscaux et pièces justificatives.",
    "Timesheets, payroll changes, and employee records.": "Feuilles de temps, changements de paie et dossiers employés.",
    "Gather the essentials to get a new client set up.": "Rassemblez les documents nécessaires à l’accueil d’un nouveau client.",
    "Client full name": "Nom complet du client", "Company name": "Nom de l’entreprise",
    "Edit client details": "Modifier les informations du client", "Update the client’s contact and document information.": "Mettez à jour les coordonnées et les informations sur les documents du client.",
    "Save client details": "Enregistrer les informations du client", "Client details saved.": "Informations du client enregistrées.",
    "e.g. Amine Benali": "Ex. Amine Benali", "e.g. ACME Accounting": "Ex. Cabinet ACME",
    "name@company.com": "nom@entreprise.com", "e.g. +213 555 01 23 45": "Ex. +213 555 01 23 45",
    "Phone number": "Numéro de téléphone", "Country code": "Indicatif du pays",
    "Enter a valid phone number for the selected country.": "Saisissez un numéro de téléphone valide pour le pays sélectionné.",
    "Choose a country code, or paste an international number to detect it automatically.": "Choisissez un indicatif ou collez un numéro international pour le détecter automatiquement.",
    "Search countries": "Rechercher un pays",
    "No countries found": "Aucun pays trouvé",
    "Document set": "Ensemble de documents",
    "Choose a document set...": "Choisir un ensemble de documents...",
    "Register client & create request": "Enregistrer le client et créer la demande",
    "Enter the client’s name, company, a valid email, phone, and document set.": "Saisissez le nom du client, son entreprise, un e-mail valide, un téléphone et un ensemble de documents.",
    "A client with this email is already registered.": "Un client avec cette adresse e-mail est déjà enregistré.",
    "The client database has not been set up yet. In Supabase SQL Editor, run the client notifications migration, then reload this page.": "La base de données clients n’est pas encore configurée. Dans l’éditeur SQL Supabase, exécutez la migration des notifications client, puis rechargez cette page.",
    Nudge: "Relancer", "Nudge queued": "Relance mise en attente",
    "This sample client is not connected to notifications. Add a real client record first.": "Ce client de démonstration n’est pas connecté aux notifications. Ajoutez d’abord un vrai client.",
    "Push alerts go to clients who sign in to the CountaDocs phone app with this verified email.": "Les notifications push sont envoyées aux clients qui se connectent à l’application mobile CountaDocs avec cette adresse e-mail vérifiée.",
    "Messages and push alerts are available in the website and client app.": "Les messages et notifications sont disponibles sur le site et dans l’application client.",
    "No clients yet. Add your first client with New request.": "Aucun client pour le moment. Ajoutez-en un avec Nouvelle demande.",
    "Enter the phone number in international format, for example +213 555 01 23 45.": "Saisissez le numéro au format international, par exemple +213 555 01 23 45.",
    "Could not load client records.": "Impossible de charger les dossiers clients.",
    "Sign in again to add a client.": "Reconnectez-vous pour ajouter un client.",
    "Accountant reminder": "Rappel du comptable", "New client and request": "Nouveau client et demande",
    "No clients match": "Aucun client ne correspond à",
    "Bookkeeping, tax documents, and client requests—organized in one calm workspace.": "Comptabilité, documents fiscaux et demandes clients réunis dans un espace simple.",
    "Less paperwork. More peace of mind.": "Moins de paperasse. Plus de sérénité.",
    "Your work,": "Votre travail,",
    "beautifully in order.": "parfaitement organisé.",
    "Collect the papers, receipts, and tax documents your clients need to send—with a clear place for everything.": "Rassemblez les documents, reçus et pièces fiscales de vos clients, avec une place pour chaque chose.",
    "Get started": "Commencer", "Sign in": "Se connecter",
    "Everything your paperwork needs.": "Tout ce qu’il faut pour vos documents.",
    "Documents without the digging": "Retrouvez facilement vos documents",
    "Keep tax forms, receipts, and statements together for each client.": "Rassemblez les formulaires fiscaux, reçus et relevés de chaque client.",
    "Gentle client follow-ups": "Relances clients en douceur",
    "See what’s missing and nudge clients when documents are due.": "Voyez les pièces manquantes et rappelez aux clients les échéances.",
    "A clear picture of every task": "Une vue claire de chaque tâche",
    "Track tax prep, bookkeeping, and payroll requests at a glance.": "Suivez en un coup d’œil la fiscalité, la comptabilité et la paie.",
    "Simple client document management": "Gestion simple des documents clients",
    "Create your workspace": "Créer votre espace",
    "Welcome back": "Ravi de vous revoir",
    "Sign in to your accounting workspace.": "Connectez-vous à votre espace comptable.",
    "Enter your email and we’ll send a sign-up link to create your account.": "Saisissez votre e-mail et nous vous enverrons un lien pour créer votre compte.",
    "A sign-up link is on its way. Check your email to finish creating your account.": "Un lien d’inscription a été envoyé. Consultez votre e-mail pour terminer la création du compte.",
    "Email me a sign-up link": "Recevoir un lien d’inscription",
    "Continue with Google": "Continuer avec Google",
    "Sign up with Google": "S’inscrire avec Google",
    "Choose a Google account": "Choisir un compte Google",
    "or continue with": "ou continuer avec",
    "Or continue with email": "Ou continuer avec un e-mail",
    Email: "E-mail",
    "Continue with email": "Continuer avec l’e-mail",
    Password: "Mot de passe", "Forgot your password?": "Mot de passe oublié ?",
    "Please enter user@domain.com": "Saisissez user@domain.com",
    "Enter a valid email address.": "Saisissez une adresse e-mail valide.",
    "At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /": "Au moins 6 caractères, 1 chiffre et 1 symbole. Exemples : .   ,   @   /",
    "Already have an account?": "Vous avez déjà un compte ?",
    "Don't have an account?": "Vous n’avez pas de compte ?",
    "Sign up": "S’inscrire",
    "Log in": "Se connecter",
    "Create account": "Créer un compte", "Back to home": "Retour à l’accueil",
    "Google sign-in is not connected yet.": "La connexion Google n’est pas encore configurée.",
    "Authentication is powered by Supabase.": "L’authentification est assurée par Supabase.",
    "Google account": "Compte Google",
    "Email account": "Compte e-mail",
    "Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app.": "Supabase n’est pas configuré. Ajoutez l’URL du projet et la clé publique à .env.local, puis redémarrez l’application.",
    "Check your email for a confirmation link before signing in.": "Consultez votre e-mail et cliquez sur le lien de confirmation avant de vous connecter.",
    "Account created, but you’re not signed in yet. Try signing in.": "Compte créé, mais vous n’êtes pas encore connecté. Essayez de vous connecter.",
    "This email is already registered. Please sign in to access your account.": "Cette adresse e-mail est déjà enregistrée. Connectez-vous pour accéder à votre compte.",
    "Email already Exists": "L’adresse e-mail existe déjà",
    "Wrong password": "Mot de passe incorrect",
    "Show password": "Afficher le mot de passe",
    "Hide password": "Masquer le mot de passe",
    "Password reset link sent. Check your email.": "Le lien de réinitialisation a été envoyé. Consultez vos e-mails.",
    "Sign out": "Se déconnecter",
    "Authentication request failed. Please try again.": "La demande d’authentification a échoué. Réessayez.",
    "Google sign-in is configured in your Supabase project, but could not start.": "Google est configuré dans votre projet Supabase, mais la connexion n’a pas pu démarrer.",
    "Enter your email address first.": "Saisissez d’abord votre adresse e-mail.",
    "Set a new password": "Définir un nouveau mot de passe",
    "Choose a new password.": "Choisissez un nouveau mot de passe.",
    "Password updated successfully.": "Mot de passe mis à jour.",
    "Please wait…": "Veuillez patienter…",
    "Add a recovery phone number in Settings after you sign in.": "Ajoutez un numéro de récupération dans les paramètres après connexion.",
    "Password recovery isn’t connected in this demo yet.": "La récupération du mot de passe n’est pas encore disponible dans cette démo.",
    "Recovery phone number": "Téléphone de récupération",
    "Recovery information is demo-only and isn’t connected to account recovery yet.": "Les informations de récupération sont une démonstration et ne sont pas encore reliées à la récupération du compte.",
    "Recovery phone saved in this demo.": "Téléphone de récupération enregistré dans cette démo.",
    "Secure document collection for accounting teams.": "Collecte sécurisée de documents pour les équipes comptables.",
    "Simple client accounting": "Comptabilité client simplifiée",
    "Built for accountants and their clients": "Pensé pour les comptables et leurs clients",
    "Every document, accounted for.": "Chaque document à sa place.",
    "Tax forms · receipts · statements": "Formulaires fiscaux · reçus · relevés",
    "TAX READY": "PRÊT POUR LES IMPÔTS",
    BOOKKEEPING: "COMPTABILITÉ",
    "BUILT FOR THE WORK BEHIND THE NUMBERS": "POUR LE TRAVAIL QUI SE CACHE DERRIÈRE LES CHIFFRES",
    "Tax forms · Receipts · Statements": "Formulaires fiscaux · Reçus · Relevés",
    "Illustration of accounting papers, receipts, and tax documents": "Illustration de documents comptables, reçus et pièces fiscales",
    "COUNTADOCS · YOUR ACCOUNTING WORKSPACE": "COUNTADOCS · VOTRE ESPACE COMPTABLE",
    "Choose a plan for your practice": "Choisissez une offre pour votre cabinet",
    "Simple pricing for calmer client work.": "Des tarifs simples pour mieux gérer vos clients.",
    "MONTHLY": "MENSUEL",
    "YEARLY": "ANNUEL",
    "Save 17%": "Économisez 17 %",
    "per month": "par mois",
    "per year": "par an",
    Starter: "Essentiel",
    Pro: "Pro",
    "7-day free trial": "Essai gratuit de 7 jours",
    "Best value": "Meilleure offre",
    "Start free trial": "Commencer l’essai gratuit",
    "Choose Pro": "Choisir Pro",
    "Up to 10 client workspaces": "Jusqu’à 10 espaces clients",
    "Unlimited client workspaces": "Espaces clients illimités",
    "Document requests and secure uploads": "Demandes de documents et dépôts sécurisés",
    "Email and phone client reminders": "Rappels clients par e-mail et téléphone",
    "Reusable accounting templates": "Modèles comptables réutilisables",
    "Priority support and team access": "Assistance prioritaire et accès équipe",
    "Plan & payment": "Offre et paiement",
    "Select a plan, then review payment setup.": "Choisissez une offre, puis consultez le paiement.",
    "Continue to payment": "Continuer vers le paiement",
    "Payment method": "Mode de paiement",
    "Set up your card": "Configurer votre carte",
    "Payment setup preview": "Aperçu de la configuration du paiement",
    "Card payment is not enabled yet. These fields are a preview only; do not enter real card details.": "Le paiement par carte n’est pas encore activé. Ces champs sont uniquement un aperçu ; ne saisissez pas de vraies coordonnées bancaires.",
    "Card number": "Numéro de carte",
    "Expiry date": "Date d’expiration",
    "Security code": "Cryptogramme",
    "First name": "Prénom",
    "Last name": "Nom",
    "Common card and local payment brands": "Cartes et moyens de paiement courants",
    "Displayed as examples only. Actual methods depend on the payment provider configured for CountaDocs.": "Exemples uniquement. Les moyens réels dépendront du prestataire de paiement configuré pour CountaDocs.",
    "Your selection": "Votre sélection",
    "Change plan": "Modifier l’offre",
    "Continue to account creation": "Continuer vers la création du compte",
    "No payment will be collected in this demo.": "Aucun paiement ne sera effectué dans cette démo.",
    "Step 1 · Choose a plan": "Étape 1 · Choisir une offre",
    "Step 2 · Payment setup": "Étape 2 · Configuration du paiement",
    "Step 3 · Create account": "Étape 3 · Créer un compte",
    "Back to plans": "Retour aux offres",
    "Included in every plan": "Inclus dans toutes les offres",
    "For growing practices": "Pour les cabinets en croissance",
    "For independent practices": "Pour les cabinets indépendants",
    "Billed annually": "Facturé annuellement",
    "Demo pricing only. No subscription is started and no payment is collected.": "Tarifs de démonstration uniquement. Aucun abonnement ni paiement n’est activé.",
    "Review your plan and payment setup.": "Vérifiez votre offre et les paramètres de paiement.",
    "Card payment": "Paiement par carte",
    "Billing period": "Période de facturation",
    "Account owner": "Titulaire du compte",
    "Secure payment by Chargily": "Paiement sécurisé par Chargily",
    "You will be redirected to Chargily’s secure page to pay with CIB or Edahabia.": "Vous serez redirigé vers la page sécurisée de Chargily pour payer avec CIB ou Edahabia.",
    "Your card details are entered on Chargily’s page and never touch CountaDocs.": "Vos données de carte sont saisies sur la page de Chargily et ne passent jamais par CountaDocs.",
    "You won’t be charged until you confirm on the payment page.": "Vous ne serez débité qu’après confirmation sur la page de paiement.",
    "Could not start the payment. Please try again.": "Impossible de démarrer le paiement. Réessayez.",
    "Network error. Please check your connection and try again.": "Erreur réseau. Vérifiez votre connexion et réessayez.",
    "Payment received. Create your account to get started.": "Paiement reçu. Créez votre compte pour commencer.",
    "Payment failed or was cancelled. Please try again.": "Le paiement a échoué ou a été annulé. Réessayez.",
    "Back to workspace": "Retour à l’espace de travail",
    "Confirm & Pay": "Confirmer et payer",
    "Review your plan and proceed to secure payment.": "Vérifiez votre offre et procédez au paiement sécurisé.",
    "Payment Method": "Mode de paiement",
    "Choose how you want to pay": "Choisissez votre mode de paiement",
    "National": "National",
    "International": "International",
    "Select your Algerian card:": "Sélectionnez votre carte algérienne :",
    "Select your international payment method:": "Sélectionnez votre moyen de paiement international :",
    "EDAHABIA": "EDAHABIA",
    "Edahabia Card": "Carte Edahabia",
    "Algérie Poste": "Algérie Poste",
    "CIB": "CIB",
    "CIB Card": "Carte CIB",
    "Algerian Bank Card": "Carte bancaire algérienne",
    "VISA": "VISA",
    "Visa Card": "Carte Visa",
    "Credit or Debit": "Crédit ou Débit",
    "MASTERCARD": "MASTERCARD",
    "Mastercard": "Mastercard",
    "Apple Pay": "Apple Pay",
    "Express Checkout": "Paiement express",
    "You will be securely redirected to Chargily Pay to pay with your selected card.": "Vous serez redirigé en toute sécurité vers Chargily Pay pour payer avec la carte sélectionnée.",
    "Payments processed securely via International Gateway (Gammal Tech).": "Paiements traités en toute sécurité via la passerelle internationale (Gammal Tech).",
    "Works with any Edahabia or CIB card": "Compatible avec toutes les cartes Edahabia ou CIB",
    "Protected by Algerian bank SMS OTP verification": "Protégé par le code de vérification SMS OTP de votre banque",
    "Instant workspace activation upon successful payment": "Activation immédiate de l’espace de travail dès validation",
    "One-time payment for 1 month (no automatic recurring charges)": "Paiement unique pour 1 mois (aucun prélèvement automatique)",
    "One-time payment for 1 year (no automatic recurring charges)": "Paiement unique pour 1 an (aucun prélèvement automatique)",
    "Accepts Visa, Mastercard, and Apple Pay": "Accepte Visa, Mastercard et Apple Pay",
    "Secure international 3D Secure verification": "Vérification internationale sécurisée 3D Secure",
    "Proceed to payment": "Continuer vers le paiement",
    "You will review and authorize the payment on Chargily's secure checkout page.": "Vous vérifierez et validerez le paiement sur la page sécurisée de Chargily.",
    "You will review and authorize the payment on the secure gateway.": "Vous vérifierez et validerez le paiement sur la passerelle sécurisée.",
    "International payments via Gammal Tech (Visa, Mastercard, Apple Pay) will be active as soon as merchant approval completes. Please select National (Edahabia / CIB) for instant checkout.": "Les paiements internationaux via Gammal Tech (Visa, Mastercard, Apple Pay) seront activés dès la finalisation de l'approbation du compte marchand. Veuillez sélectionner National (Edahabia / CIB) pour un paiement immédiat.",
    "Chargily Pay": "Chargily Pay",
    "Secure payment gateway in Algeria": "Passerelle de paiement sécurisée en Algérie",
    "Supports Carte EDAHABIA (Algérie Poste) and CIB bank cards": "Cartes EDAHABIA (Algérie Poste) et CIB acceptées",
    "Secure 256-bit encryption with bank OTP SMS verification": "Chiffrement sécurisé 256-bit et confirmation par code SMS (OTP)",
    "Pay with Chargily (CIB / EDAHABIA)": "Payer avec Chargily (CIB / EDAHABIA)",
    "Click the button to open Chargily and enter your card details.": "Cliquez sur le bouton ci-contre pour ouvrir Chargily et saisir vos coordonnées de carte.",
    documents: "documents",
  },
  ar: {
    "Main navigation": "التنقل الرئيسي", WORKSPACE: "مساحة العمل", Dashboard: "لوحة التحكم", Clients: "العملاء", Messages: "الرسائل",
    Templates: "القوالب", Settings: "الإعدادات", "Free workspace": "مساحة عمل مجانية", "4 of 10 client spaces used": "تم استخدام 4 من أصل 10 مساحات للعملاء",
    "Manage plan": "إدارة الخطة", "Workspace owner": "مدير مساحة العمل", Workspace: "مساحة العمل", "client spaces used": "مساحات عمل العملاء المستخدمة",
    "Search clients...": "ابحث عن العملاء...", Search: "بحث", Notifications: "الإشعارات", "Mark all as read": "تحديد الكل كمقروء",
    Filters: "تصفية",
    Documents: "المستندات", "Browse and manage files shared by your clients.": "تصفح الملفات التي يشاركها عملاؤك وأدرها.",
    "Filter documents by client": "تصفية المستندات حسب العميل", "Filter documents by category": "تصفية المستندات حسب الفئة",
    "Documents uploaded by your clients will appear here.": "ستظهر هنا المستندات التي يرفعها عملاؤك.",
    "View client uploads": "عرض ملفات العميل", clients: "العملاء",
    "Client conversations": "محادثات العملاء", "Search conversations...": "ابحث في المحادثات...",
    "Select a conversation": "اختر محادثة", "No messages yet. Send the first message.": "لا توجد رسائل بعد. أرسل أول رسالة.",
    "Write a message...": "اكتب رسالة...", Send: "إرسال", "Could not load messages.": "تعذر تحميل الرسائل.",
    Retry: "إعادة المحاولة",
    "Could not send this message.": "تعذر إرسال الرسالة.", "Could not mark messages as read.": "تعذر تحديد الرسائل كمقروءة.",
    "Could not update this message.": "تعذر تعديل هذه الرسالة.", "Could not delete this message.": "تعذر حذف هذه الرسالة.",
    "Delete this message?": "هل تريد حذف هذه الرسالة؟", "Confirm delete?": "تأكيد الحذف؟", "Confirm delete message": "تأكيد حذف الرسالة",
    "Message actions": "إجراءات الرسالة", "Reply, forward, and pin require the latest Supabase Messages migration.": "تتطلب ميزات الرد وإعادة التوجيه والتثبيت أحدث ترحيل لرسائل Supabase.", "Message info": "معلومات الرسالة", Reply: "رد", Copy: "نسخ", Forward: "إعادة توجيه", Pin: "تثبيت", Unpin: "إلغاء التثبيت", Pinned: "مثبتة", "Forwarded message": "رسالة معاد توجيهها", "Replying to": "رد على", "Read by client": "قرأها العميل", "Read by you": "قرأتها", "Not read yet": "لم تُقرأ بعد", "Forward to": "إعادة التوجيه إلى", "Choose a client": "اختر عميلاً", Copied: "تم النسخ", Forwarded: "تمت إعادة التوجيه", "Sent at": "أُرسلت في", "Read at": "قُرئت في", "Original message unavailable": "الرسالة الأصلية غير متاحة",
    "Edit message": "تعديل الرسالة", "Delete message": "حذف الرسالة",
    Edit: "تعديل", Save: "حفظ", "Saving…": "جارٍ الحفظ…", "Deleting…": "جارٍ الحذف…",
    "Messages must be 4,000 characters or fewer.": "يجب ألا تتجاوز الرسائل 4000 حرف.",
    All: "الكل", "All Clients": "كل العملاء", "Bank Statements": "كشوف الحسابات",
    Invoices: "الفواتير", "Tax Forms": "النماذج الضريبية", Payroll: "الرواتب", Receipts: "الإيصالات", Other: "أخرى",
    "Search documents...": "ابحث عن المستندات...", "Upload document": "رفع مستند",
    "Select a client": "اختر عميلاً", "No documents found": "لم يتم العثور على مستندات",
    "Could not load documents.": "تعذر تحميل المستندات.", "Document uploaded successfully.": "تم رفع المستند بنجاح.",
    "Share link copied. It expires in 1 hour.": "تم نسخ الرابط. تنتهي صلاحيته خلال ساعة.",
    "Could not copy the share link.": "تعذر نسخ رابط المشاركة.",
    Uploads: "الملفات", Share: "مشاركة", Delete: "حذف", "Delete client": "حذف العميل",
    "Are you sure you want to delete": "هل أنت متأكد من حذف",
    "This will also permanently remove all their uploaded documents.": "سيؤدي هذا أيضاً إلى حذف جميع مستنداته المرفوعة نهائياً.",
    "You are all caught up!": "أنت على اطلاع بكل جديد!", "Loading notifications…": "جارٍ تحميل الإشعارات…",
    "Clients documents will show here.": "ستظهر هنا مستندات العملاء.",
    "New document received": "تم استلام مستند جديد",
    "The clients uploads will appear here.": "ستظهر هنا ملفات العملاء.", "YOUR ACCOUNTING WORKSPACE": "مساحة عملك المحاسبية",
    "Good morning": "صباح الخير", "Good afternoon": "مساء الخير", "Good evening": "مساء الخير", "Here’s what’s happening with your client documents.": "إليك آخر المستجدات المتعلقة بمستندات عملائك.",
    "New request": "طلب جديد", "Workspace overview": "نظرة عامة على مساحة العمل", "Active requests": "الطلبات النشطة",
    "from last month": "مقارنة بالشهر الماضي", "Pending uploads": "المستندات بانتظار الرفع", Across: "لدى",
    "4 clients": "4 عملاء", "Documents received": "المستندات المستلمة", "this month": "هذا الشهر",
    "Waiting on clients": "بانتظار العملاء", "Needs your attention": "تتطلب اهتمامك", "Client document requests": "طلبات مستندات العملاء",
    "Keep your client work moving forward.": "تابع إنجاز الأعمال الخاصة بعملائك.", "View all": "عرض الكل",
    "Document activity": "نشاط المستندات", "Reminder sent": "تم إرسال تذكير",
    "Awaiting client action": "بانتظار إجراء العميل", "complete": "مكتمل", "More options for": "خيارات إضافية لـ",
    "Open": "فتح", "No requests match": "لا توجد طلبات تطابق", "Review file": "مراجعة الملف",
    "No uploads match": "لا توجد مستندات تطابق", "Showing": "عرض", "active requests": "طلبات نشطة",
    "recent uploads": "ملفات مرفوعة حديثاً", "See all activity": "عرض كل الأنشطة", "Recent activity": "النشاط الأخير",
    "The latest updates from your workspace.": "أحدث التحديثات في مساحة عملك.", "More activity options": "المزيد من خيارات النشاط",
    "uploaded": "رفع", "12 minutes ago": "قبل 12 دقيقة", "Reminder sent to": "تم إرسال تذكير إلى",
    "1 hour ago": "قبل ساعة", "completed": "أكمل", "Payroll documents": "مستندات الرواتب", Yesterday: "أمس",
    "A LITTLE TIP": "نصيحة صغيرة", "Less chasing,": "ملاحقة أقل،", "more accounting.": "ومحاسبة أكثر.",
    "Set up a request template once and reuse it for every client.": "أنشئ قالب طلب مرة واحدة وأعد استخدامه مع كل عميل.",
    "Explore templates": "استكشف القوالب", "YOUR WORKSPACE": "مساحة عملك", "Manage your client relationships and their documents.": "أدر علاقات العملاء ومستنداتهم.",
    "Your clients": "عملاؤك", "client workspaces": "مساحات العملاء", request: "طلب", requests: "طلبات",
    "active request": "طلب نشط",
    "SAVE TIME ON REPEAT WORK": "وفّر وقت المهام المتكررة", "Request templates": "قوالب الطلبات",
    "Start with a template and tailor document requests to each client.": "ابدأ بقالب وعدّل طلبات المستندات لكل عميل.",
    "Use template": "استخدم القالب", "WORKSPACE PREFERENCES": "تفضيلات مساحة العمل",
    "Manage your CountaDocs workspace and profile.": "أدر مساحة عملك وملفك الشخصي في CountaDocs.", "Workspace profile": "ملف مساحة العمل",
    "Your accounting practice details.": "تفاصيل مكتب المحاسبة الخاص بك.", "Workspace name": "اسم مساحة العمل",
    "Enter your workspace name": "أدخل اسم مساحة العمل",
    "Workspace name saved in this demo.": "تم حفظ اسم مساحة العمل في هذه النسخة التجريبية.",
    "Owner name": "اسم المدير", "Email address": "البريد الإلكتروني", "Save changes": "حفظ التغييرات",
    "Changes saved": "تم حفظ التغييرات", "Help & support": "المساعدة والدعم", "Simple, secure client document collection.": "جمع مستندات العملاء بسهولة وأمان.",
    "Create a document request": "إنشاء طلب مستندات", "Choose a client and the documents you need from them.": "اختر عميلاً والمستندات التي تحتاجها منه.",
    "Client name": "اسم العميل", "e.g. Acme Accounting": "مثال: شركة المحاسبة", "Request template": "قالب الطلب",
    "Choose a template...": "اختر قالباً...", "Custom document request": "طلب مستندات مخصص",
    "Enter a client name and choose a request type.": "أدخل اسم العميل واختر نوع الطلب.",
    Cancel: "إلغاء", "Create request": "إنشاء الطلب", "Demo workspace · client records and requests stay in this page only.": "مساحة تجريبية · تبقى سجلات العملاء والطلبات على هذه الصفحة فقط.",
    "Close dialog": "إغلاق", "View": "عرض",
    "Open profile settings": "فتح إعدادات الملف الشخصي", active: "نشط",
    "Bank statement": "كشف حساب بنكي",
    "Expense receipts": "إيصالات المصاريف", "Today, 10:42 AM": "اليوم، 10:42 صباحاً",
    "Today, 09:18 AM": "اليوم، 9:18 صباحاً", "Yesterday, 04:35 PM": "أمس، 4:35 مساءً",
    "Monthly bookkeeping": "مسك الدفاتر الشهري", "Year-End Tax": "الإقرار الضريبي السنوي",
    "Monthly Payroll": "الرواتب الشهرية", "New Client Onboarding": "إعداد عميل جديد",
    "Year-end tax preparation": "إعداد الضرائب السنوية", "Monthly payroll": "إدارة الرواتب الشهرية",
    "New client onboarding": "إعداد عميل جديد", "Bank statements, receipts, invoices, and expense reports.": "كشوف الحساب والإيصالات والفواتير وتقارير المصاريف.",
    "Financial statements, tax forms, and supporting records.": "البيانات المالية والنماذج الضريبية والسجلات الداعمة.",
    "Timesheets, payroll changes, and employee records.": "سجلات الدوام وتعديلات الرواتب وملفات الموظفين.",
    "Gather the essentials to get a new client set up.": "اجمع المستندات الأساسية لبدء العمل مع عميل جديد.",
    "Client full name": "الاسم الكامل للعميل", "Company name": "اسم الشركة",
    "Edit client details": "تعديل بيانات العميل", "Update the client’s contact and document information.": "حدّث معلومات الاتصال والمستندات الخاصة بالعميل.",
    "Save client details": "حفظ بيانات العميل", "Client details saved.": "تم حفظ بيانات العميل.",
    "e.g. Amine Benali": "مثال: أمين بن علي", "e.g. ACME Accounting": "مثال: مكتب المحاسبة",
    "name@company.com": "name@company.com", "e.g. +213 555 01 23 45": "مثال: ‎+213 555 01 23 45",
    "Phone number": "رقم الهاتف", "Country code": "رمز الدولة",
    "Enter a valid phone number for the selected country.": "أدخل رقم هاتف صحيحاً للدولة المحددة.",
    "Choose a country code, or paste an international number to detect it automatically.": "اختر رمز الدولة أو الصق رقماً دولياً ليتم التعرف على الدولة تلقائياً.",
    "Search countries": "ابحث عن دولة",
    "No countries found": "لم يتم العثور على دول",
    "Document set": "مجموعة المستندات",
    "Choose a document set...": "اختر مجموعة المستندات...",
    "Register client & create request": "تسجيل العميل وإنشاء الطلب",
    "Enter the client’s name, company, a valid email, phone, and document set.": "أدخل اسم العميل والشركة وبريداً إلكترونياً صحيحاً ورقم الهاتف ومجموعة المستندات.",
    "A client with this email is already registered.": "يوجد عميل مسجل بالفعل بهذا البريد الإلكتروني.",
    "The client database has not been set up yet. In Supabase SQL Editor, run the client notifications migration, then reload this page.": "لم يتم إعداد قاعدة بيانات العملاء بعد. شغّل ترحيل إشعارات العملاء في محرر SQL لدى Supabase، ثم أعد تحميل الصفحة.",
    Nudge: "تذكير", "Nudge queued": "التذكير قيد الانتظار",
    "This sample client is not connected to notifications. Add a real client record first.": "هذا العميل التجريبي غير متصل بالإشعارات. أضف سجلاً حقيقياً للعميل أولاً.",
    "Push alerts go to clients who sign in to the CountaDocs phone app with this verified email.": "تصل إشعارات الدفع إلى العملاء الذين يسجلون الدخول إلى تطبيق CountaDocs بهذا البريد الإلكتروني المؤكد.",
    "Messages and push alerts are available in the website and client app.": "تتوفر الرسائل والإشعارات في الموقع وتطبيق العميل.",
    "No clients yet. Add your first client with New request.": "لا يوجد عملاء بعد. أضف أول عميل باستخدام طلب جديد.",
    "Enter the phone number in international format, for example +213 555 01 23 45.": "أدخل رقم الهاتف بالصيغة الدولية، مثال ‎+213 555 01 23 45.",
    "Could not load client records.": "تعذر تحميل سجلات العملاء.",
    "Sign in again to add a client.": "سجّل الدخول مرة أخرى لإضافة عميل.",
    "Accountant reminder": "تذكير من المحاسب", "New client and request": "عميل جديد وطلب",
    "No clients match": "لا يوجد عملاء يطابقون",
    "Bookkeeping, tax documents, and client requests—organized in one calm workspace.": "المحاسبة والوثائق الضريبية وطلبات العملاء، منظمة في مساحة عمل واحدة.",
    "Less paperwork. More peace of mind.": "أوراق أقل. راحة بال أكثر.",
    "Your work,": "عملك،",
    "beautifully in order.": "منظم بكل سهولة.",
    "Collect the papers, receipts, and tax documents your clients need to send—with a clear place for everything.": "اجمع الأوراق والإيصالات والوثائق الضريبية من عملائك، واجعل لكل شيء مكاناً واضحاً.",
    "Get started": "ابدأ الآن", "Sign in": "تسجيل الدخول",
    "Everything your paperwork needs.": "كل ما تحتاجه مستنداتك.",
    "Documents without the digging": "اعثر على مستنداتك بسهولة",
    "Keep tax forms, receipts, and statements together for each client.": "احتفظ بالنماذج الضريبية والإيصالات والكشوف معاً لكل عميل.",
    "Gentle client follow-ups": "متابعة العملاء بسهولة",
    "See what’s missing and nudge clients when documents are due.": "اعرف المستندات الناقصة وذكّر العملاء عند الحاجة.",
    "A clear picture of every task": "رؤية واضحة لكل مهمة",
    "Track tax prep, bookkeeping, and payroll requests at a glance.": "تابع الضرائب والمحاسبة والرواتب بنظرة واحدة.",
    "Simple client document management": "إدارة بسيطة لمستندات العملاء",
    "Create your workspace": "أنشئ مساحة عملك",
    "Welcome back": "مرحباً بعودتك",
    "Sign in to your accounting workspace.": "سجّل الدخول إلى مساحة عملك المحاسبية.",
    "Enter your email and we’ll send a sign-up link to create your account.": "أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإنشاء حسابك.",
    "A sign-up link is on its way. Check your email to finish creating your account.": "تم إرسال رابط التسجيل. تحقق من بريدك لإكمال إنشاء الحساب.",
    "Email me a sign-up link": "أرسل رابط التسجيل إلى بريدي",
    "Continue with Google": "المتابعة باستخدام Google",
    "Sign up with Google": "إنشاء حساب باستخدام Google",
    "Choose a Google account": "اختر حساب Google",
    "or continue with": "أو تابع باستخدام",
    "Or continue with email": "أو تابع باستخدام البريد الإلكتروني",
    Email: "البريد الإلكتروني",
    "Continue with email": "المتابعة بالبريد الإلكتروني",
    Password: "كلمة المرور", "Forgot your password?": "هل نسيت كلمة المرور؟",
    "Please enter user@domain.com": "أدخل user@domain.com",
    "Enter a valid email address.": "أدخل عنوان بريد إلكتروني صالحاً.",
    "At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /": "6 أحرف على الأقل، رقم واحد، ورمز واحد. أمثلة: .   ,   @   /",
    "Already have an account?": "لديك حساب بالفعل؟",
    "Don't have an account?": "ليس لديك حساب؟",
    "Sign up": "إنشاء حساب",
    "Log in": "تسجيل الدخول",
    "Create account": "إنشاء حساب", "Back to home": "العودة للرئيسية",
    "Google sign-in is not connected yet.": "تسجيل الدخول عبر Google غير متاح حالياً.",
    "Authentication is powered by Supabase.": "تتم المصادقة عبر Supabase.",
    "Google account": "حساب Google",
    "Email account": "حساب البريد الإلكتروني",
    "Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app.": "لم يتم إعداد Supabase. أضف رابط المشروع والمفتاح العام إلى .env.local ثم أعد تشغيل التطبيق.",
    "Check your email for a confirmation link before signing in.": "تحقق من بريدك الإلكتروني واضغط على رابط التأكيد قبل تسجيل الدخول.",
    "Account created, but you’re not signed in yet. Try signing in.": "تم إنشاء الحساب، لكنك لم تسجل الدخول بعد. حاول تسجيل الدخول.",
    "This email is already registered. Please sign in to access your account.": "هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول للوصول إلى حسابك.",
    "Email already Exists": "البريد الإلكتروني موجود بالفعل",
    "Wrong password": "كلمة المرور غير صحيحة",
    "Show password": "إظهار كلمة المرور",
    "Hide password": "إخفاء كلمة المرور",
    "Password reset link sent. Check your email.": "تم إرسال رابط إعادة تعيين كلمة المرور. تحقق من بريدك.",
    "Sign out": "تسجيل الخروج",
    "Authentication request failed. Please try again.": "فشل طلب المصادقة. حاول مرة أخرى.",
    "Google sign-in is configured in your Supabase project, but could not start.": "تم إعداد Google في مشروع Supabase لكن تعذر بدء تسجيل الدخول.",
    "Enter your email address first.": "أدخل بريدك الإلكتروني أولاً.",
    "Set a new password": "عيّن كلمة مرور جديدة",
    "Choose a new password.": "اختر كلمة مرور جديدة.",
    "Password updated successfully.": "تم تحديث كلمة المرور بنجاح.",
    "Please wait…": "يرجى الانتظار…",
    "Add a recovery phone number in Settings after you sign in.": "أضف رقم هاتف للاسترداد من الإعدادات بعد تسجيل الدخول.",
    "Password recovery isn’t connected in this demo yet.": "استرداد كلمة المرور غير متاح في هذه النسخة التجريبية بعد.",
    "Recovery phone number": "رقم هاتف الاسترداد",
    "Recovery information is demo-only and isn’t connected to account recovery yet.": "معلومات الاسترداد تجريبية فقط ولم تُربط باسترداد الحساب بعد.",
    "Recovery phone saved in this demo.": "تم حفظ رقم الاسترداد في هذه النسخة التجريبية.",
    "Secure document collection for accounting teams.": "جمع آمن للمستندات لفرق المحاسبة.",
    "Simple client accounting": "محاسبة العملاء بسهولة",
    "Built for accountants and their clients": "مصمم للمحاسبين وعملائهم",
    "Every document, accounted for.": "كل مستند في مكانه.",
    "Tax forms · receipts · statements": "نماذج ضريبية · إيصالات · كشوفات",
    "TAX READY": "جاهز للضرائب",
    BOOKKEEPING: "مسك الدفاتر",
    "BUILT FOR THE WORK BEHIND THE NUMBERS": "مصمم للأعمال التي تقف وراء الأرقام",
    "Tax forms · Receipts · Statements": "نماذج ضريبية · إيصالات · كشوفات",
    "Illustration of accounting papers, receipts, and tax documents": "رسم توضيحي لمستندات محاسبية وإيصالات ووثائق ضريبية",
    "COUNTADOCS · YOUR ACCOUNTING WORKSPACE": "COUNTADOCS · مساحة عملك المحاسبية",
    "Choose a plan for your practice": "اختر خطة لمكتبك",
    "Simple pricing for calmer client work.": "أسعار بسيطة لإدارة عملائك بسهولة.",
    "MONTHLY": "شهري",
    "YEARLY": "سنوي",
    "Save 17%": "وفّر 17٪",
    "per month": "شهرياً",
    "per year": "سنوياً",
    Starter: "الأساسية",
    Pro: "الاحترافية",
    "7-day free trial": "تجربة مجانية لمدة 7 أيام",
    "Best value": "أفضل قيمة",
    "Start free trial": "ابدأ التجربة المجانية",
    "Choose Pro": "اختر الاحترافية",
    "Up to 10 client workspaces": "حتى 10 مساحات للعملاء",
    "Unlimited client workspaces": "مساحات عملاء غير محدودة",
    "Document requests and secure uploads": "طلبات المستندات والرفع الآمن",
    "Email and phone client reminders": "تذكيرات العملاء عبر البريد والهاتف",
    "Reusable accounting templates": "قوالب محاسبية قابلة لإعادة الاستخدام",
    "Priority support and team access": "دعم ذو أولوية وإمكانية وصول الفريق",
    "Plan & payment": "الخطة والدفع",
    "Select a plan, then review payment setup.": "اختر خطة ثم راجع إعداد الدفع.",
    "Continue to payment": "المتابعة إلى الدفع",
    "Payment method": "طريقة الدفع",
    "Set up your card": "إعداد بطاقتك",
    "Payment setup preview": "معاينة إعداد الدفع",
    "Card payment is not enabled yet. These fields are a preview only; do not enter real card details.": "الدفع بالبطاقة غير مفعّل بعد. هذه الحقول للمعاينة فقط؛ لا تدخل بيانات بطاقة حقيقية.",
    "Card number": "رقم البطاقة",
    "Expiry date": "تاريخ الانتهاء",
    "Security code": "رمز الأمان",
    "First name": "الاسم الأول",
    "Last name": "اسم العائلة",
    "Common card and local payment brands": "البطاقات ووسائل الدفع المحلية الشائعة",
    "Displayed as examples only. Actual methods depend on the payment provider configured for CountaDocs.": "للعرض فقط. تعتمد وسائل الدفع الفعلية على مزود الدفع الذي سيتم إعداده في CountaDocs.",
    "Your selection": "اختيارك",
    "Change plan": "تغيير الخطة",
    "Continue to account creation": "المتابعة لإنشاء الحساب",
    "No payment will be collected in this demo.": "لن يتم تحصيل أي مبلغ في هذه النسخة التجريبية.",
    "Step 1 · Choose a plan": "الخطوة 1 · اختر خطة",
    "Step 2 · Payment setup": "الخطوة 2 · إعداد الدفع",
    "Step 3 · Create account": "الخطوة 3 · إنشاء حساب",
    "Back to plans": "العودة إلى الخطط",
    "Included in every plan": "مشمول في جميع الخطط",
    "For growing practices": "للمكاتب المحاسبية النامية",
    "For independent practices": "للمكاتب المحاسبية المستقلة",
    "Billed annually": "الفوترة سنوية",
    "Demo pricing only. No subscription is started and no payment is collected.": "الأسعار تجريبية فقط. لن يتم تفعيل اشتراك أو تحصيل أي دفعة.",
    "Review your plan and payment setup.": "راجع خطتك وإعداد الدفع.",
    "Card payment": "الدفع بالبطاقة",
    "Billing period": "فترة الفوترة",
    "Account owner": "مالك الحساب",
    "Secure payment by Chargily": "دفع آمن عبر Chargily",
    "You will be redirected to Chargily’s secure page to pay with CIB or Edahabia.": "ستتم إعادة توجيهك إلى صفحة Chargily الآمنة للدفع عبر CIB أو الذهبية.",
    "Your card details are entered on Chargily’s page and never touch CountaDocs.": "تُدخل بيانات بطاقتك في صفحة Chargily ولا تمر عبر CountaDocs أبداً.",
    "You won’t be charged until you confirm on the payment page.": "لن يتم خصم أي مبلغ حتى تؤكد الدفع في صفحة الدفع.",
    "Could not start the payment. Please try again.": "تعذر بدء الدفع. حاول مرة أخرى.",
    "Network error. Please check your connection and try again.": "خطأ في الشبكة. تحقق من اتصالك وحاول مرة أخرى.",
    "Payment received. Create your account to get started.": "تم استلام الدفع. أنشئ حسابك للبدء.",
    "Payment failed or was cancelled. Please try again.": "فشل الدفع أو تم إلغاؤه. حاول مرة أخرى.",
    "Back to workspace": "العودة إلى مساحة العمل",
    "Confirm & Pay": "تأكيد واشتراك",
    "Review your plan and proceed to secure payment.": "راجع خطتك وتابع لإتمام الدفع الآمن.",
    "Payment Method": "طريقة الدفع",
    "Choose how you want to pay": "اختر طريقة الدفع المناسبة لك",
    "National": "محلي (الجزائر)",
    "International": "دولي",
    "Select your Algerian card:": "اختر بطاقتك الجزائرية:",
    "Select your international payment method:": "اختر وسيلة الدفع الدولية:",
    "EDAHABIA": "الذهبية (EDAHABIA)",
    "Edahabia Card": "بطاقة الذهبية",
    "Algérie Poste": "بريد الجزائر",
    "CIB": "CIB",
    "CIB Card": "بطاقة بنكية CIB",
    "Algerian Bank Card": "بطاقة بنكية جزائرية",
    "VISA": "VISA",
    "Visa Card": "بطاقة فيزا (Visa)",
    "Credit or Debit": "بطاقة ائتمان أو خصم",
    "MASTERCARD": "ماستركارد (Mastercard)",
    "Mastercard": "ماستركارد",
    "Apple Pay": "آبل باي (Apple Pay)",
    "Express Checkout": "دفع سريع",
    "You will be securely redirected to Chargily Pay to pay with your selected card.": "ستتم إعادة توجيهك بأمان إلى Chargily Pay للدفع بالبطاقة المحددة.",
    "Payments processed securely via International Gateway (Gammal Tech).": "تتم معالجة المدفوعات بأمان عبر البوابة الدولية (Gammal Tech).",
    "Works with any Edahabia or CIB card": "يعمل مع أي بطاقة ذهبية أو بطاقة بنكية CIB",
    "Protected by Algerian bank SMS OTP verification": "محمي برمز التحقق SMS OTP من البنك",
    "Instant workspace activation upon successful payment": "تفعيل فوري لمساحة العمل بمجرد نجاح عملية الدفع",
    "One-time payment for 1 month (no automatic recurring charges)": "دفع لمرة واحدة لمدة شهر (بدون تجديد أو خصم تلقائي)",
    "One-time payment for 1 year (no automatic recurring charges)": "دفع لمرة واحدة لمدة سنة (بدون تجديد أو خصم تلقائي)",
    "Accepts Visa, Mastercard, and Apple Pay": "يقبل بطاقات فيزا، ماستركارد و Apple Pay",
    "Secure international 3D Secure verification": "تحقق أمني دولي 3D Secure",
    "Proceed to payment": "المتابعة إلى الدفع",
    "You will review and authorize the payment on Chargily's secure checkout page.": "ستراجع وتؤكد عملية الدفع في صفحة شارجيلي الآمنة.",
    "You will review and authorize the payment on the secure gateway.": "ستراجع وتؤكد عملية الدفع في بوابة الدفع الآمنة.",
    "International payments via Gammal Tech (Visa, Mastercard, Apple Pay) will be active as soon as merchant approval completes. Please select National (Edahabia / CIB) for instant checkout.": "سيتم تفعيل الدفع الدولي عبر Gammal Tech (Visa و Mastercard و Apple Pay) فور اكتمال الموافقة. يرجى اختيار الدفع المحلي (الذهبية / CIB) للدفع الفوري.",
    "Chargily Pay": "شارجيلي باي (Chargily Pay)",
    "Secure payment gateway in Algeria": "بوابة دفع إلكتروني آمنة في الجزائر",
    "Supports Carte EDAHABIA (Algérie Poste) and CIB bank cards": "دعم بطاقة الذهبية (بريد الجزائر) والبطاقات البنكية CIB",
    "Secure 256-bit encryption with bank OTP SMS verification": "تشفير آمن 256-bit مع تأكيد الدفع عبر رمز SMS البنكي (OTP)",
    "Pay with Chargily (CIB / EDAHABIA)": "الدفع عبر Chargily (الذهبية / CIB)",
    "Click the button to open Chargily and enter your card details.": "انقر على الزر للمتابعة إلى Chargily وإدخال بيانات بطاقتك.",
    documents: "مستندات",
  },
};

const initialRequests: DocumentRequest[] = [
  { id: 1, client: "ABC Corp", service: "Q3 Bookkeeping", progress: 75, status: "Reminder sent" },
  { id: 2, client: "Beta Tech", service: "Year-End Tax", progress: 30, status: "Awaiting client action" },
  { id: 3, client: "Gamma Inc", service: "Monthly Payroll", progress: 95, status: "Reminder sent" },
  { id: 4, client: "Delta LLC", service: "New Client Onboarding", progress: 10, status: "Awaiting client action", detail: "Silvia Despiant" },
];

const pendingUploads = [
  { client: "ABC Corp", file: "Bank statement — September.pdf", date: "Today, 10:42 AM", kind: "Bank statement" },
  { client: "Beta Tech", file: "2025 expense receipts.zip", date: "Today, 09:18 AM", kind: "Expense receipts" },
  { client: "Gamma Inc", file: "Payroll register — Week 40.xlsx", date: "Yesterday, 04:35 PM", kind: "Payroll" },
];

const templates = [
  { title: "Monthly bookkeeping", description: "Bank statements, receipts, invoices, and expense reports.", count: "8 documents", color: "teal" },
  { title: "Year-end tax preparation", description: "Financial statements, tax forms, and supporting records.", count: "12 documents", color: "blue" },
  { title: "Monthly payroll", description: "Timesheets, payroll changes, and employee records.", count: "5 documents", color: "violet" },
  { title: "New client onboarding", description: "Gather the essentials to get a new client set up.", count: "7 documents", color: "amber" },
];

const subscriptionPlans: {
  id: PlanId;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
}[] = [
  {
    id: "starter",
    monthlyPrice: 1500,
    yearlyPrice: 15000,
    features: [
      "Up to 10 client workspaces",
      "Document requests and secure uploads",
      "Reusable accounting templates",
    ],
  },
  {
    id: "pro",
    monthlyPrice: 3500,
    yearlyPrice: 35000,
    features: [
      "Unlimited client workspaces",
      "Document requests and secure uploads",
      "Email and phone client reminders",
      "Reusable accounting templates",
      "Priority support and team access",
    ],
  },
];

function AlgeriaFlag({ width = 18, height = 13 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 900 600" style={{ borderRadius: "2px", flexShrink: 0, display: "inline-block", verticalAlign: "middle" }} aria-hidden="true">
      <rect width="450" height="600" fill="#006233" />
      <rect x="450" width="450" height="600" fill="#ffffff" />
      <circle cx="450" cy="300" r="150" fill="#d21034" />
      <circle cx="480" cy="300" r="120" fill="#ffffff" />
      <polygon points="450,225 468,278 525,278 478,312 496,365 450,332 404,365 422,312 375,278 432,278" fill="#d21034" />
    </svg>
  );
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
    clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" /></>,
    templates: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
    fileStack: <><path d="M8 3h8l5 5v10a2 2 0 0 1-2 2h-1" /><path d="M16 3v5h5M4 7h8l4 4v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="M12 7v4h4M5 15h6m-6 3h6" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.2 12H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    nudgeBell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    filter: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
    reply: <><path d="m9 14-4-4 4-4" /><path d="M5 10h8a6 6 0 0 1 6 6v2" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>,
    forward: <><path d="m14 4 7 6-7 6v-4h-3a7 7 0 0 0-7 7v1a9 9 0 0 1 9-11h1z" /></>,
    pin: <><path d="m16 3 5 5-4 1-3 3v5l-2 2-2-7-5-5 2-2 7 2 3-3z" /><path d="m3 21 7-7" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    pencil: <><path d="m12 20 9-9-4-4-9 9-1 5z" /><path d="m15 7 4 4" /><path d="M20 20h-6" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v7m6-7v7" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15.5 15.5 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.1 0 2.1-.2 3-.5" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.file}</svg>;
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>;
}

// One bell component used everywhere (header + Nudge button) so both are always the same size.
// Change BELL_SIZE to resize every bell in the app at once.
const BELL_SIZE = 22;

function BellIcon({ ringing = false, size = BELL_SIZE, className = "" }: { ringing?: boolean; size?: number; className?: string }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src={ringing ? "/bell-active.png" : "/bell-idle.png"}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      unoptimized
      width={size}
    />
  );
}

function profileText(user: User | null, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = user?.user_metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function profileInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function isValidAuthEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isStrongPassword(password: string) {
  return /^(?=.*[0-9])(?=.*[^A-Za-z0-9\s])\S{6,}$/.test(password);
}

function ProfileAvatar({ name, imageUrl, className }: { name: string; imageUrl: string; className: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <span className={`avatar ${className}`}>
      {imageUrl && !imageFailed
        ? <Image alt="" className="profile-avatar-image" height={34} onError={() => setImageFailed(true)} referrerPolicy="no-referrer" src={imageUrl} unoptimized width={34} />
        : profileInitials(name)}
    </span>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("starter");
  const [authIdentifier, setAuthIdentifier] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [greeting, setGreeting] = useState<Greeting>("Good morning");
  const [view, setView] = useState<View>("Dashboard");
  const [tab, setTab] = useState<"requests" | "uploads">("requests");
  const [requests, setRequests] = useState(initialRequests);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsLoadFailed, setClientsLoadFailed] = useState(false);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  // Live-connection problems (e.g. "socket closed: 1006") are kept separate so they
  // never hide real notifications or replace the "all caught up" empty state.
  const [realtimeError, setRealtimeError] = useState("");
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [messageSchemaNotice, setMessageSchemaNotice] = useState("");
  const [interactiveMessageSchemaAvailable, setInteractiveMessageSchemaAvailable] = useState(false);
  const [workspaceLoadAttempt, setWorkspaceLoadAttempt] = useState(0);
  const [messageSearch, setMessageSearch] = useState("");
  const [selectedMessageClientId, setSelectedMessageClientId] = useState<string | null>(null);
  const requestedMessageClientIdRef = useRef<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageDraft, setEditMessageDraft] = useState("");
  const [savingMessageEdit, setSavingMessageEdit] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [confirmingDeleteMessageId, setConfirmingDeleteMessageId] = useState<string | null>(null);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<string | null>(null);
  const [messageInfoId, setMessageInfoId] = useState<string | null>(null);
  const [replyingToMessageId, setReplyingToMessageId] = useState<string | null>(null);
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
  const [forwardingToClientId, setForwardingToClientId] = useState<string | null>(null);
  const [pinningMessageId, setPinningMessageId] = useState<string | null>(null);
  const [messagesToast, setMessagesToast] = useState("");
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory | "all">("all");
  const [documentClientId, setDocumentClientId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState("");
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [bellAnimationVersion, setBellAnimationVersion] = useState(0);
  const previousUnreadCount = useRef(unreadCount);
  // Wraps the bell button + popover so clicks outside can close it.
  const notificationRef = useRef<HTMLDivElement>(null);
  const [newClient, setNewClient] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>("DZ");
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryPickerRef = useRef<HTMLDivElement>(null);
  const [newService, setNewService] = useState("");
  const [nudgedClients, setNudgedClients] = useState<Set<string>>(() => new Set());
  const [sendingNudgeTo, setSendingNudgeTo] = useState<string | null>(null);
  const [clientNotice, setClientNotice] = useState("");
  const [clientEditMode, setClientEditMode] = useState(false);
  const [clientFilter, setClientFilter] = useState("all");
  const [showClientFilters, setShowClientFilters] = useState(false);
  const [formError, setFormError] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [paymentCategory, setPaymentCategory] = useState<"national" | "international">("national");
  const [nationalCard, setNationalCard] = useState<"edahabia" | "cib">("edahabia");
  const [internationalCard, setInternationalCard] = useState<"visa" | "mastercard" | "applepay">("visa");
  const [internationalCurrency, setInternationalCurrency] = useState<"USD" | "EUR">("USD");
  const [workspaceCode, setWorkspaceCode] = useState("");
  const [workspaceCodeLoading, setWorkspaceCodeLoading] = useState(false);
  const [showConnectClientsModal, setShowConnectClientsModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const copyWorkspaceCode = async () => {
    if (!workspaceCode) return;
    try {
      await navigator.clipboard.writeText(workspaceCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch (err) {
      console.error("Failed to copy code", err);
    }
  };
  // Tracks an in-progress password recovery so later auth events don't push the user to the dashboard.
  const recoveryRef = useRef(false);

  useEffect(() => {
    if (!openMessageActionsId) return;

    const closeMenu = () => {
      setOpenMessageActionsId(null);
      setConfirmingDeleteMessageId(null);
      setMessageInfoId(null);
      setForwardingMessageId(null);
      setForwardingToClientId(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const container = event.target.closest<HTMLElement>("[data-message-action-container]");
      if (container?.dataset.messageActionContainer !== openMessageActionsId) closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMessageActionsId]);

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();
      setGreeting(hour >= 5 && hour < 12 ? "Good morning" : hour < 18 && hour >= 12 ? "Good afternoon" : "Good evening");
    };

    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (unreadCount > previousUnreadCount.current) {
      setBellAnimationVersion((version) => version + 1);
    }
    previousUnreadCount.current = unreadCount;
  }, [unreadCount]);

  // Close the notifications popover on outside click or Escape.
  useEffect(() => {
    if (!showNotifications) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !notificationRef.current?.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNotifications(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showNotifications]);

  const t = (text: string) => locale === "en" ? text : translations[locale][text] ?? text;

  // Handles redirect back from Chargily (success_url / failure_url = /?payment=success|failed).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("payment");
    if (!status) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (status === "success" || status === "paid") {
      setAuthMode("signup");
      setAuthNotice(t("Payment received. Create your account to get started."));
      setScreen("auth");
    } else if (status === "failed" || status === "canceled" || status === "cancelled") {
      setCheckoutError(t("Payment failed or was cancelled. Please try again."));
      setScreen("checkout");
    }
  }, [locale]);
  const localizedPhoneCountries = useMemo(() => {
    const countryNames = new Intl.DisplayNames([locale], { type: "region" });
    return phoneCountries
      .map(({ country, callingCode }) => ({
        country,
        callingCode,
        name: countryNames.of(country) ?? country,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);
  const filteredPhoneCountries = useMemo(() => {
    const query = countrySearch.trim().toLocaleLowerCase(locale);
    if (!query) return localizedPhoneCountries;
    return localizedPhoneCountries.filter(({ country, callingCode, name }) =>
      name.toLocaleLowerCase(locale).includes(query)
      || country.toLocaleLowerCase(locale).includes(query)
      || callingCode.includes(query.replace(/^\+/, "")),
    );
  }, [countrySearch, locale, localizedPhoneCountries]);
  const selectedPhoneCountry = localizedPhoneCountries.find(({ country }) => country === phoneCountry)
    ?? localizedPhoneCountries.find(({ country }) => country === "DZ")!;
  const localizedView = (item: View) => t(item);
  const profileName = profileText(authUser, ["full_name", "name", "display_name"], authUser?.email?.split("@")[0] || authUser?.phone || t("Account owner"));
  const profileContact = authUser?.email ?? authUser?.phone ?? "";
  const profileContactLabel = authUser?.email ? t("Email address") : t("Phone number");
  const profileContactType = authUser?.email ? "email" : "tel";
  const profileImage = profileText(authUser, ["avatar_url", "picture"], "");
  const authProvider = authUser?.app_metadata.provider;
  const profileAccountType = authProvider === "google" ? t("Google account") : t("Email account");
  const authEmailValid = isValidAuthEmail(authIdentifier.trim());
  const authPasswordValid = isStrongPassword(authPassword);
  const authFormValid = authMode === "signup"
    ? authEmailValid
    : authMode === "reset"
      ? authPasswordValid
      : authEmailValid && authPasswordValid;

  useEffect(() => {
    if (!countryPickerOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && !countryPickerRef.current?.contains(event.target)) {
        setCountryPickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCountryPickerOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [countryPickerOpen]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser((current) => current?.id === session?.user.id
        ? current
        : session?.user ?? null);
      if (session) setClientsLoading(true);
      if (!session) {
        setClients([]);
        setClientsLoadFailed(false);
        if (event !== "INITIAL_SESSION") setClientsLoading(false);
        setDocuments([]);
        setDocumentsLoading(false);
        setDocumentsError("");
        setNotifications([]);
        setNotificationsLoading(false);
        setNotificationError("");
        setRealtimeError("");
        setMessages([]);
        setMessagesLoading(false);
        setMessagesError("");
        setMessageSchemaNotice("");
        setInteractiveMessageSchemaAvailable(false);
        setSelectedMessageClientId(null);
        setClientNotice("");
        if (event === "SIGNED_OUT") setScreen("landing");
        return;
      }
      setAuthNotice("");
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setAuthMode("reset");
        setAuthPassword("");
        setScreen("auth");
      } else if (!recoveryRef.current && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        setScreen("app");
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (disposed) return;
      if (error) {
        setAuthNotice(error.message);
        setClientsLoading(false);
        return;
      }
      if (data.session) {
        setClientsLoading(true);
        setClientsLoadFailed(false);
        setAuthUser((current) => current?.id === data.session.user.id ? current : data.session.user);
        if (!recoveryRef.current) setScreen("app");
      } else {
        setAuthUser(null);
        setClientsLoading(false);
        setClientsLoadFailed(false);
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setClientsLoading(false);
        setAuthNotice(error instanceof Error ? error.message : "Authentication request failed. Please try again.");
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const activeUser = authUser;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const activeSupabase = supabase;

    let disposed = false;
    let channel: ReturnType<typeof activeSupabase.channel> | null = null;
    requestedMessageClientIdRef.current = new URLSearchParams(window.location.search).get("clientId");
    async function loadWorkspaceRecords() {
      const { data: clientRows, error: clientsError } = await activeSupabase
        .from("clients")
        .select("id, name, company_name, email, phone, document_set, requests")
        .eq("manager_id", activeUser.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .abortSignal(AbortSignal.timeout(8000));
      if (disposed) return;
      if (clientsError) {
        setClientsLoading(false);
        setClientsLoadFailed(true);
        setClientNotice(`Could not load client records. ${clientsError.message}`);
        setNotificationError(`Could not load notifications because client records failed to load. ${clientsError.message}`);
        setNotificationsLoading(false);
        setMessagesError(`Could not load messages because client records failed to load. ${clientsError.message}`);
        setMessagesLoading(false);
        return;
      }

      const loadedClients: Client[] = (clientRows ?? []).map((client, index) => ({
        id: String(client.id),
        name: client.name,
        company: client.company_name,
        email: client.email,
        phone: client.phone,
        documentSet: client.document_set,
        requests: client.requests,
        color: ["teal", "blue", "violet", "amber"][index % 4],
      }));
      setClients(loadedClients);
      setClientsLoadFailed(false);
      setSelectedMessageClientId((current) => {
        const requestedClient = loadedClients.find((client) => client.id === requestedMessageClientIdRef.current);
        if (requestedClient?.id) return requestedClient.id;
        return current && loadedClients.some((client) => client.id === current)
          ? current
          : loadedClients[0]?.id ?? null;
      });
      setClientsLoading(false);
      setClientNotice("");
      const clientsById = new Map(loadedClients.flatMap((client) => client.id ? [[client.id, client] as const] : []));
      const clientIds = loadedClients.flatMap((client) => client.id ? [client.id] : []);
      if (clientIds.length === 0) {
        setSelectedMessageClientId(null);
        setDocuments([]);
        setNotifications([]);
        setMessages([]);
        setDocumentsLoading(false);
        setNotificationsLoading(false);
        setMessagesLoading(false);
        setMessageSchemaNotice("");
        setInteractiveMessageSchemaAvailable(false);
        return;
      }

      let readIds = new Set<string>();
      try {
        readIds = readNotificationIds(activeUser.id);
      } catch (error: unknown) {
        setNotificationError(error instanceof Error ? error.message : "Could not load saved notification read state.");
      }

      const documentsLoad = activeSupabase
        .from("client_documents")
        .select("id, client_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, category, created_at")
        .in("client_id", clientIds)
        .order("created_at", { ascending: false })
        .abortSignal(AbortSignal.timeout(10000))
        .then(async ({ data: initialDocumentRows, error: initialDocumentError }) => {
          if (disposed) return;
          // Explicitly typed so the fallback query (which has no `category` column) is assignable.
          let documentRows: StoredClientDocument[] | null = initialDocumentRows;
          let documentError = initialDocumentError;
          if (documentError && isMissingClientDocumentCategory(documentError)) {
            const fallback = await activeSupabase
              .from("client_documents")
              .select("id, client_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, created_at")
              .in("client_id", clientIds)
              .order("created_at", { ascending: false })
              .abortSignal(AbortSignal.timeout(10000));
            documentRows = fallback.data;
            documentError = fallback.error;
          }
          if (disposed) return;
          if (documentError) {
            setDocumentsError(`Could not load documents. ${documentError.message}`);
            setDocuments([]);
          } else {
            const fetched = (documentRows ?? []).map((document): ClientDocument => ({
              id: document.id,
              clientId: String(document.client_id),
              uploadedBy: document.uploaded_by,
              storagePath: document.storage_path,
              fileName: document.file_name,
              mimeType: document.mime_type,
              sizeBytes: Number(document.size_bytes),
              category: typeof document.category === "string" ? documentCategoryFromDatabase(document.category) : "other",
              createdAt: document.created_at,
            }));

            setDocuments(fetched);
            const clientUploads = fetched.filter((doc) => doc.uploadedBy !== activeUser.id);
            const notifs: NotificationItem[] = clientUploads.map((doc) => {
              const client = clientsById.get(doc.clientId);
              return {
                id: `doc-${doc.id}`,
                clientId: doc.clientId,
                documentId: doc.id,
                clientName: client?.name ?? "Client",
                clientCompany: client?.company ?? "",
                title: "New document received",
                body: `${client?.name ?? "Client"} uploaded ${doc.fileName}`,
                createdAt: doc.createdAt,
                read: readIds.has(`doc-${doc.id}`),
              };
            });
            setNotifications(notifs);
            setDocumentsError("");
          }
          setDocumentsLoading(false);
          setNotificationsLoading(false);
        });

      const messagesLoad = (async () => {
        const initialMessages = await activeSupabase
          .from("client_messages")
          .select(clientMessageColumns)
          .in("client_id", clientIds)
          .order("created_at", { ascending: true })
          .abortSignal(AbortSignal.timeout(10000));
        let messageRows: unknown[] | null = initialMessages.data;
        let messageError = initialMessages.error;
        let supportsInteractiveActions = !messageError;

        if (messageError && isMissingInteractiveMessageColumns(messageError)) {
          setMessageSchemaNotice("Reply, forward, and pin require the latest Supabase Messages migration.");
          const fallback = await activeSupabase
            .from("client_messages")
            .select(baseClientMessageColumns)
            .in("client_id", clientIds)
            .order("created_at", { ascending: true })
            .abortSignal(AbortSignal.timeout(10000));
          messageRows = fallback.data;
          messageError = fallback.error;
          supportsInteractiveActions = false;
        } else if (!messageError) {
          setMessageSchemaNotice("");
        }

        if (disposed) return;
        setInteractiveMessageSchemaAvailable(supportsInteractiveActions);
        if (messageError) {
          setMessagesError(`Could not load messages. ${messageError.message}`);
          setMessages([]);
        } else {
          setMessages((messageRows ?? []).filter(isStoredClientMessage).map(messageFromRecord));
          setMessagesError("");
        }
        setMessagesLoading(false);
      })();

      const notificationsLoad = Promise.resolve().then(() => {
        if (disposed) return;
        setNotificationsLoading(false);
      });

      await Promise.all([documentsLoad, messagesLoad, notificationsLoad]);
      if (disposed) return;

      channel = activeSupabase
        .channel(`manager-notifications-${activeUser.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "client_documents",
        }, (payload) => {
          if (payload.eventType === "DELETE") {
            if (typeof payload.old.id === "string") {
              setDocuments((current) => current.filter((document) => document.id !== payload.old.id));
            }
            return;
          }
          const record = payload.new;
          if (
            typeof record.id !== "string"
            || (typeof record.client_id !== "string" && typeof record.client_id !== "number")
            || typeof record.uploaded_by !== "string"
            || typeof record.storage_path !== "string"
            || typeof record.file_name !== "string"
            || typeof record.mime_type !== "string"
            || typeof record.size_bytes !== "number"
            || typeof record.category !== "string"
            || typeof record.created_at !== "string"
            || !clientsById.has(String(record.client_id))
          ) return;
          setDocuments((current) => [{
            id: record.id as string,
            clientId: String(record.client_id),
            uploadedBy: record.uploaded_by as string,
            storagePath: record.storage_path as string,
            fileName: record.file_name as string,
            mimeType: record.mime_type as string,
            sizeBytes: record.size_bytes as number,
            category: documentCategoryFromDatabase(record.category as string),
            createdAt: record.created_at as string,
          }, ...current.filter((document) => document.id !== record.id)]);

          // A client sent a new document: show it in the bell right away (red dot + list item),
          // without depending on a database trigger.
          if (payload.eventType === "INSERT" && record.uploaded_by !== activeUser.id) {
            const client = clientsById.get(String(record.client_id));
            if (!client) return;
            const documentId = record.id as string;
            const item: NotificationItem = {
              id: `doc-${documentId}`,
              clientId: String(record.client_id),
              documentId,
              clientName: client.name,
              clientCompany: client.company,
              title: "New document received",
              body: `${client.name} sent ${record.file_name as string}`,
              createdAt: record.created_at as string,
              read: false,
            };
            setNotifications((current) =>
              current.some((notification) => notification.documentId === documentId) ? current : [item, ...current]);
          }
        })

        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "client_messages",
        }, (payload) => {
          if (payload.eventType === "DELETE") {
            if (typeof payload.old.id === "string") {
              setMessages((current) => current.filter((message) => message.id !== payload.old.id));
            }
            return;
          }
          if (!isStoredClientMessage(payload.new) || !clientsById.has(String(payload.new.client_id))) return;
          const incoming = messageFromRecord(payload.new);
          setMessages((current) => {
            const next = current.filter((message) => message.id !== incoming.id);
            next.push(incoming);
            return next.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
          });
        })
        .subscribe((status, error) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") setRealtimeError("");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setRealtimeError(`Live notifications are unavailable. ${error?.message ?? status}`);
          }
        });
    }

    void Promise.resolve().then(() => {
      if (disposed) return;
      setNotifications([]);
      setNotificationError("");
      setRealtimeError("");
      setNotificationsLoading(true);
      setDocumentsLoading(true);
      setMessagesLoading(true);
      setInteractiveMessageSchemaAvailable(false);
      setMessageSchemaNotice("");
      setClientsLoading(true);
      setDocumentsError("");
      setMessagesError("");
      return loadWorkspaceRecords();
    }).catch((error: unknown) => {
      if (!disposed) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        setClientNotice(`Could not load client records. ${message}`);
        setNotificationError(`Could not load notifications. ${message}`);
        setNotificationsLoading(false);
        setMessagesError(`Could not load messages. ${message}`);
        setMessagesLoading(false);
        setClientsLoading(false);
        setClientsLoadFailed(true);
        setDocumentsLoading(false);
      }
    });

    return () => {
      disposed = true;
      if (channel) void activeSupabase.removeChannel(channel);
    };
  }, [authUser, workspaceLoadAttempt]);

  const formatPrice = (amount: number) => new Intl.NumberFormat(
    locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en-DZ",
    { style: "currency", currency: "DZD", maximumFractionDigits: 0 },
  ).format(amount);
  const activePlan = subscriptionPlans.find((plan) => plan.id === selectedPlan) ?? subscriptionPlans[0];
  const activePrice = billingCycle === "monthly" ? activePlan.monthlyPrice : activePlan.yearlyPrice;

  // International pricing converted from DZD using official bank rates
  // 1 USD = 137.17 DZD | 1 EUR = 150.79 DZD
  const intlPrices: Record<string, { USD: { monthly: number; yearly: number }; EUR: { monthly: number; yearly: number } }> = {
    starter: { USD: { monthly: 10.94, yearly: 109.35 }, EUR: { monthly: 9.95, yearly: 99.48 } },
    pro:     { USD: { monthly: 25.52, yearly: 255.16 }, EUR: { monthly: 23.21, yearly: 232.11 } },
  };
  const intlAmount = (intlPrices[selectedPlan]?.[internationalCurrency]?.[billingCycle === "monthly" ? "monthly" : "yearly"] ?? 0).toFixed(2);
  const intlSymbol = internationalCurrency === "EUR" ? "€" : "$";
  const displayPrice = paymentCategory === "national"
    ? formatPrice(activePrice)
    : `${intlSymbol}${intlAmount}`;

  async function submitSupabaseAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthNotice("");
    if (authMode !== "reset" && !isValidAuthEmail(authIdentifier.trim())) {
      setAuthNotice(t("Please enter user@domain.com"));
      return;
    }
    if ((authMode === "login" || authMode === "reset") && !isStrongPassword(authPassword)) {
      setAuthNotice(t("At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /"));
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthNotice(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === "reset") {
        const { error } = await supabase.auth.updateUser({ password: authPassword });
        if (error) {
          setAuthNotice(error.message);
          return;
        }
        recoveryRef.current = false;
        setAuthNotice(t("Password updated successfully."));
        setAuthPassword("");
        setAuthMode("login");
        setView("Dashboard");
        setScreen("app");
        return;
      }

      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signInWithOtp({
          email: authIdentifier.trim(),
          options: {
            emailRedirectTo: window.location.origin,
            shouldCreateUser: true,
          },
        });
        if (error) {
          setAuthNotice(error.message);
          return;
        }
        if (data.session) {
          setView("Dashboard");
          setScreen("app");
          return;
        }
        setAuthNotice(t("A sign-up link is on its way. Check your email to finish creating your account."));
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: authIdentifier.trim(),
        password: authPassword,
      });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) {
          setAuthPassword("");
          setAuthNotice(t("Wrong password"));
        } else {
          setAuthNotice(error.message);
        }
        return;
      }
      setView("Dashboard");
      setScreen("app");
    } catch (error: unknown) {
      setAuthNotice(error instanceof Error ? error.message : t("Authentication request failed. Please try again."));
    } finally {
      setAuthBusy(false);
    }
  }

  async function startGoogleSignIn() {
    setAuthNotice("");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthNotice(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) setAuthNotice(error.message);
    } catch (error: unknown) {
      setAuthNotice(error instanceof Error ? error.message : t("Google sign-in is configured in your Supabase project, but could not start."));
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendPasswordReset() {
    setAuthNotice("");
    if (!isValidAuthEmail(authIdentifier.trim())) {
      setAuthNotice(t("Enter your email address first."));
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthNotice(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authIdentifier.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        setAuthNotice(error.message);
        return;
      }
      setAuthNotice(t("Password reset link sent. Check your email."));
    } catch (error: unknown) {
      setAuthNotice(error instanceof Error ? error.message : t("Authentication request failed. Please try again."));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSettingsNotice(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSettingsNotice(error.message);
        return;
      }
      setSettingsNotice("");
      setView("Dashboard");
      setScreen("landing");
    } catch (error: unknown) {
      setSettingsNotice(error instanceof Error ? error.message : t("Authentication request failed. Please try again."));
    }
  }

  function saveWorkspaceName() {
    setWorkspaceName(workspaceName.trim());
    setSettingsNotice(t("Workspace name saved in this demo."));
  }

  const filteredRequests = useMemo(() => requests.filter((request) =>
    `${request.client} ${request.service}`.toLowerCase().includes(search.toLowerCase()),
  ), [requests, search]);
  const filteredUploads = useMemo(() => pendingUploads.filter((upload) =>
    `${upload.client} ${upload.file} ${upload.kind}`.toLowerCase().includes(search.toLowerCase()),
  ), [search]);
  const filteredClients = clients.filter((client) =>
    selectedClientId
      ? client.id === selectedClientId
      : `${client.name} ${client.company} ${client.email} ${client.phone} ${client.documentSet}`.toLowerCase().includes(search.toLowerCase())
        && (clientFilter === "all" || client.documentSet === clientFilter),
  );
  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const filteredDocuments = documents.filter((document) => {
    const client = clients.find((item) => item.id === document.clientId);
    const matchesSearch = `${document.fileName} ${client?.name ?? ""} ${client?.company ?? ""}`
      .toLocaleLowerCase(locale)
      .includes(documentSearch.trim().toLocaleLowerCase(locale));
    const matchesCategory = documentCategory === "all" || document.category === documentCategory;
    const matchesClient = documentClientId === null || document.clientId === documentClientId;
    return matchesSearch && matchesCategory && matchesClient;
  });
  const documentCountsByClient = new Map<string, number>();
  for (const document of documents) {
    documentCountsByClient.set(document.clientId, (documentCountsByClient.get(document.clientId) ?? 0) + 1);
  }
  const selectedMessageClient = clients.find((client) => client.id === selectedMessageClientId);
  const messagesForSelectedClient = messages
    .filter((message) => message.clientId === selectedMessageClientId)
    .sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  const replyingToMessage = messages.find((message) => message.id === replyingToMessageId);
  const unreadMessagesByClient = new Map<string, number>();
  const latestMessageByClient = new Map<string, ClientMessage>();
  for (const message of messages) {
    latestMessageByClient.set(message.clientId, message);
    if (message.senderId !== authUser?.id && !message.managerReadAt) {
      unreadMessagesByClient.set(message.clientId, (unreadMessagesByClient.get(message.clientId) ?? 0) + 1);
    }
  }
  const filteredMessageClients = clients.filter((client) => {
    const lastMessage = client.id ? latestMessageByClient.get(client.id) : undefined;
    return `${client.name} ${client.company} ${lastMessage?.body ?? ""}`
      .toLocaleLowerCase(locale)
      .includes(messageSearch.trim().toLocaleLowerCase(locale));
  });

  function markNotificationsAsRead(notificationId?: string) {
    const updatedNotifications = notifications.map((notification) => ({
      ...notification,
      read: notification.read || notificationId === undefined || notification.id === notificationId,
    }));
    setNotifications(updatedNotifications);
    if (!authUser) return;

    try {
      window.localStorage.setItem(
        `autolyn-read-notifications-${authUser.id}`,
        JSON.stringify(updatedNotifications.filter((notification) => notification.read).map((notification) => notification.id)),
      );
      setNotificationError("");
    } catch (error: unknown) {
      setNotificationError(error instanceof Error ? `Could not save notification read state. ${error.message}` : "Could not save notification read state.");
    }
  }

  async function markConversationRead(clientId: string) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }
    const { error } = await supabase.rpc("mark_client_messages_read", { p_client_id: clientId });
    if (error) {
      setMessagesError(`${t("Could not mark messages as read.")} ${error.message}`);
      return;
    }
    const readAt = new Date().toISOString();
    setMessages((current) => current.map((message) => (
      message.clientId === clientId && message.senderId !== authUser?.id && !message.managerReadAt
        ? { ...message, managerReadAt: readAt }
        : message
    )));
    setMessagesError("");
  }

  function openConversation(clientId: string) {
    setSelectedMessageClientId(clientId);
    setEditingMessageId(null);
    setEditMessageDraft("");
    setReplyingToMessageId(null);
    setMessageInfoId(null);
    setForwardingMessageId(null);
    setOpenMessageActionsId(null);
    setConfirmingDeleteMessageId(null);
    setView("Messages");
    void markConversationRead(clientId);
  }

  async function copyMessage(message: ClientMessage) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(message.body);
      setOpenMessageActionsId(null);
      setMessagesToast(t("Copied"));
      window.setTimeout(() => setMessagesToast(""), 1800);
    } catch (error: unknown) {
      setMessagesError(error instanceof Error ? error.message : "Could not copy this message.");
    }
  }

  async function toggleMessagePin(message: ClientMessage) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }
    if (pinningMessageId) return;

    setPinningMessageId(message.id);
    setMessagesError("");
    try {
      const { data, error } = await supabase.rpc("set_client_message_pinned", {
        p_message_id: message.id,
        p_pinned: !message.pinnedAt,
      });
      if (error) throw new Error(error.message);
      const pinnedAt = typeof data === "string" ? data : null;
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, pinnedAt } : item));
      setOpenMessageActionsId(null);
      setMessagesToast(t(pinnedAt ? "Pinned" : "Unpin"));
      window.setTimeout(() => setMessagesToast(""), 1800);
    } catch (error: unknown) {
      setMessagesError(error instanceof Error ? error.message : "Could not update the pinned message.");
    } finally {
      setPinningMessageId(null);
    }
  }

  async function forwardMessageToClient(message: ClientMessage, client: Client) {
    if (!authUser || !client.id || forwardingToClientId) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setForwardingToClientId(client.id);
    setMessagesError("");
    const createdAt = new Date().toISOString();
    const optimisticId = `pending-forward-${createdAt}`;
    const optimisticMessage: ClientMessage = {
      id: optimisticId,
      clientId: client.id,
      senderId: authUser.id,
      senderRole: "manager",
      body: message.body,
      createdAt,
      managerReadAt: createdAt,
      clientReadAt: null,
      replyToMessageId: null,
      forwardedFromMessageId: message.id,
      pinnedAt: null,
    };
    setMessages((current) => [...current, optimisticMessage]);
    try {
      const { data, error } = await supabase
        .from("client_messages")
        .insert({
          client_id: client.id,
          sender_id: authUser.id,
          sender_role: "manager",
          body: message.body,
          forwarded_from_message_id: message.id,
        })
        .select(interactiveMessageSchemaAvailable ? clientMessageColumns : baseClientMessageColumns)
        .single();
      if (error) throw new Error(error.message);
      if (!isStoredClientMessage(data)) throw new Error("The forwarded message response was invalid.");
      const savedMessage = messageFromRecord(data);
      setMessages((current) => [...current.filter((item) => item.id !== optimisticId && item.id !== savedMessage.id), savedMessage]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
      setSelectedMessageClientId(client.id);
      setOpenMessageActionsId(null);
      setForwardingMessageId(null);
      setMessagesToast(t("Forwarded"));
      window.setTimeout(() => setMessagesToast(""), 1800);
    } catch (error: unknown) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessagesError(error instanceof Error ? error.message : "Could not forward this message.");
    } finally {
      setForwardingToClientId(null);
    }
  }

  function editMessage(message: ClientMessage) {
    setEditingMessageId(message.id);
    setEditMessageDraft(message.body);
    setOpenMessageActionsId(null);
    setConfirmingDeleteMessageId(null);
    setMessagesError("");
  }

  async function saveMessageEdit(message: ClientMessage) {
    const body = editMessageDraft.trim();
    if (!authUser || !body || savingMessageEdit) return;
    if (body.length > 4000) {
      setMessagesError(t("Messages must be 4,000 characters or fewer."));
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setSavingMessageEdit(true);
    setMessagesError("");
    try {
      const { data, error } = await supabase
        .from("client_messages")
        .update({ body })
        .eq("id", message.id)
        .eq("sender_id", authUser.id)
        .eq("sender_role", "manager")
        .select(interactiveMessageSchemaAvailable ? clientMessageColumns : baseClientMessageColumns)
        .single();
      if (error) throw new Error(error.message);
      if (!isStoredClientMessage(data)) throw new Error("The updated message response was invalid.");
      const updatedMessage = messageFromRecord(data);
      setMessages((current) => current.map((item) => item.id === message.id ? updatedMessage : item));
      setEditingMessageId(null);
      setEditMessageDraft("");
    } catch (error: unknown) {
      setMessagesError(error instanceof Error ? error.message : t("Could not update this message."));
    } finally {
      setSavingMessageEdit(false);
    }
  }

  async function deleteMessage(message: ClientMessage) {
    if (!authUser || deletingMessageId) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setDeletingMessageId(message.id);
    setMessagesError("");
    try {
      const { error } = await supabase
        .from("client_messages")
        .delete()
        .eq("id", message.id)
        .eq("sender_id", authUser.id)
        .eq("sender_role", "manager")
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      if (editingMessageId === message.id) {
        setEditingMessageId(null);
        setEditMessageDraft("");
      }
      setConfirmingDeleteMessageId(null);
      setOpenMessageActionsId(null);
    } catch (error: unknown) {
      setMessagesError(error instanceof Error ? error.message : t("Could not delete this message."));
    } finally {
      setDeletingMessageId(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageText = messageDraft.trim();
    const selectedClient = clients.find((client) => client.id === selectedMessageClientId);
    const replyToMessageId = replyingToMessageId;
    if (sendingMessage || clientsLoading || !messageText || !selectedClient?.id || !authUser) return;
    if (messageText.length > 4000) {
      setMessagesError(t("Messages must be 4,000 characters or fewer."));
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessagesError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setSendingMessage(true);
    setMessagesError("");
    const optimisticId = `pending-${Date.now()}`;
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: ClientMessage = {
      id: optimisticId,
      clientId: selectedClient.id,
      senderId: authUser.id,
      senderRole: "manager",
      body: messageText,
      createdAt: optimisticCreatedAt,
      managerReadAt: optimisticCreatedAt,
      clientReadAt: null,
      replyToMessageId,
      forwardedFromMessageId: null,
      pinnedAt: null,
    };
    setMessages((current) => [...current, optimisticMessage]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
    setMessageDraft("");
    try {
      const insertPayload = {
        client_id: selectedClient.id,
        sender_id: authUser.id,
        sender_role: "manager" as const,
        body: messageText,
        ...(interactiveMessageSchemaAvailable && replyToMessageId
          ? { reply_to_message_id: replyToMessageId }
          : {}),
      };
      const { data, error } = await supabase
        .from("client_messages")
        .insert(insertPayload)
        .select(interactiveMessageSchemaAvailable ? clientMessageColumns : baseClientMessageColumns)
        .single();
      if (error) throw new Error(error.message);
      if (!isStoredClientMessage(data)) throw new Error("The message service returned an invalid response.");
      const savedMessage = messageFromRecord(data);
      setMessages((current) => [...current.filter((item) => item.id !== optimisticId && item.id !== savedMessage.id), savedMessage]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
      setReplyingToMessageId(null);
    } catch (error: unknown) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessageDraft((current) => current || messageText);
      setMessagesError(error instanceof Error ? error.message : t("Could not send this message."));
    } finally {
      setSendingMessage(false);
    }
  }

  async function shareDocument(document: ClientDocument) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setDocumentsError(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }
    setDocumentsError("");
    try {
      const { data, error } = await supabase.storage
        .from("client-documents")
        .createSignedUrl(document.storagePath, 60 * 60, { download: document.fileName });
      if (error) throw new Error(error.message);
      await navigator.clipboard.writeText(data.signedUrl);
      setDocumentNotice(t("Share link copied. It expires in 1 hour."));
    } catch (error: unknown) {
      setDocumentsError(error instanceof Error ? `${t("Could not copy the share link.")} ${error.message}` : t("Could not copy the share link."));
    }
  }

  async function deleteClient(client: Client) {
    const supabase = getSupabaseClient();
    if (!supabase || !client.id) {
      setDocumentsError(t("Could not delete this client."));
      return;
    }
    setDeletingClient(true);
    setDocumentsError("");
    try {
      const storagePaths: string[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: clientDocuments, error: documentQueryError } = await supabase
          .from("client_documents")
          .select("storage_path")
          .eq("client_id", client.id)
          .range(from, from + pageSize - 1);
        if (documentQueryError) throw new Error(documentQueryError.message);
        storagePaths.push(...(clientDocuments ?? []).map((document) => document.storage_path));
        if (!clientDocuments || clientDocuments.length < pageSize) break;
      }
      for (let index = 0; index < storagePaths.length; index += 100) {
        const { error } = await supabase.storage.from("client-documents").remove(storagePaths.slice(index, index + 100));
        if (error) throw new Error(error.message);
      }

      const { error: deleteError } = await supabase.from("clients").delete().eq("id", client.id);
      if (deleteError) {
        throw new Error(`Could not delete the client record after removing its files. ${deleteError.message}`);
      }

      setClients((current) => current.filter((item) => item.id !== client.id));
      setDocuments((current) => current.filter((document) => document.clientId !== client.id));
      setRequests((current) => current.filter((request) => request.client !== client.company));
      setNotifications((current) => current.filter((notification) => notification.clientId !== client.id));
      setMessages((current) => current.filter((message) => message.clientId !== client.id));
      setSelectedDocumentId(null);
      if (documentClientId === client.id) setDocumentClientId(null);
      if (selectedClientId === client.id) setSelectedClientId(null);
      if (selectedMessageClientId === client.id) setSelectedMessageClientId(clients.find((item) => item.id !== client.id)?.id ?? null);
      setClientToDelete(null);
    } catch (error: unknown) {
      setDocumentsError(error instanceof Error ? error.message : t("Could not delete this client."));
    } finally {
      setDeletingClient(false);
    }
  }

  function editClientDetails(client: Client) {
    setEditingClient(client);
    setNewClient(client.name);
    setNewCompany(client.company);
    setNewEmail(client.email);
    const recognizedPhone = recognizePhoneCountry(client.phone, phoneCountry);
    setPhoneCountry(recognizedPhone.country);
    setNewPhone(recognizedPhone.phone);
    setNewService(client.documentSet);
    setFormError("");
    setClientNotice("");
    setShowRequestForm(true);
  }

  function closeClientForm() {
    setShowRequestForm(false);
    setEditingClient(null);
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingClient) return;
    if (!newClient.trim() || !newCompany.trim() || !newEmail.trim() || !newPhone.trim() || !newService.trim()) {
      setFormError(t("Enter the client’s name, company, a valid email, phone, and document set."));
      return;
    }
    const parsedPhone = parsePhoneNumberFromString(newPhone, phoneCountry);
    if (!parsedPhone?.isValid()) {
      setFormError(t("Enter a valid phone number for the selected country."));
      return;
    }
    if (clients.some((client) => client.id !== editingClient?.id && client.email.toLowerCase() === newEmail.trim().toLowerCase())) {
      setFormError(t("A client with this email is already registered."));
      return;
    }
    const clientName = newClient.trim();
    const companyName = newCompany.trim();
    const phoneNumber = parsedPhone.number;
    const requestId = Date.now();
    const supabase = getSupabaseClient();
    if (!supabase || !authUser) {
      setFormError(t("Sign in again to add a client."));
      return;
    }

    setSavingClient(true);
    try {
      if (editingClient) {
        if (!editingClient.id) {
          setFormError(t("Could not save the client record."));
          return;
        }
        const { error } = await supabase
          .from("clients")
          .update({
            name: clientName,
            company_name: companyName,
            email: newEmail.trim(),
            phone: phoneNumber,
            document_set: newService,
          })
          .eq("id", editingClient.id)
          .eq("manager_id", authUser.id)
          .select("id")
          .single();
        if (error) {
          setFormError(error.message);
          return;
        }
        setClients((current) => current.map((client) => client.id === editingClient.id
          ? {
            ...client,
            name: clientName,
            company: companyName,
            email: newEmail.trim(),
            phone: phoneNumber,
            documentSet: newService,
          }
          : client));
        setClientNotice(t("Client details saved."));
      } else {
        const { data: savedClient, error } = await supabase
          .from("clients")
          .insert({
            manager_id: authUser.id,
            name: clientName,
            company_name: companyName,
            email: newEmail.trim(),
            phone: phoneNumber,
            document_set: newService,
            requests: 1,
          })
          .select("id")
          .single();
        if (error) {
          setFormError(
            error.code === "PGRST205" || error.message.includes("public.clients")
              ? t("The client database has not been set up yet. In Supabase SQL Editor, run the client notifications migration, then reload this page.")
              : error.message,
          );
          return;
        }

        setClients((current) => [
          {
            id: String(savedClient.id),
            name: clientName,
            company: companyName,
            email: newEmail.trim(),
            phone: phoneNumber,
            documentSet: newService,
            requests: 1,
            color: ["teal", "blue", "violet", "amber"][current.length % 4],
          },
          ...current,
        ]);
      }
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "Could not save the client record.");
      return;
    } finally {
      setSavingClient(false);
    }
    if (!editingClient) {
      setRequests((current) => [
        { id: requestId, client: companyName, service: newService, progress: 0, status: "Awaiting client action" },
        ...current,
      ]);
    }
    setNewClient("");
    setNewCompany("");
    setNewEmail("");
    setNewPhone("");
    setPhoneCountry("DZ");
    setNewService("");
    setFormError("");
    setEditingClient(null);
    setShowRequestForm(false);
    if (!editingClient) setTab("requests");
    setView("Clients");
  }

  async function sendClientNudge(client: Client) {
    setClientNotice("");
    if (!client.id) {
      setClientNotice(t("This sample client is not connected to notifications. Add a real client record first."));
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setClientNotice(t("Supabase isn’t configured. Add the project URL and publishable key to .env.local, then restart the app."));
      return;
    }

    setSendingNudgeTo(client.email);
    try {
      const { data, error } = await supabase.functions.invoke("send-client-nudge", {
        body: { clientId: client.id },
      });
      if (error) {
        setClientNotice(error.message);
        return;
      }
      if (typeof data?.success !== "boolean" || typeof data?.message !== "string") {
        setClientNotice("The notification service returned an invalid response. Please try again.");
        return;
      }
      setClientNotice(data.message);
      if (data.success) {
        setNudgedClients((current) => new Set(current).add(client.email));
      }
    } catch (error: unknown) {
      setClientNotice(error instanceof Error ? error.message : "Could not send the client reminder.");
    } finally {
      setSendingNudgeTo(null);
    }
  }

  // Fetch or generate workspace code for the current manager
  async function fetchWorkspaceCode() {
    const supabase = getSupabaseClient();
    if (!supabase || !authUser) return;
    setWorkspaceCodeLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch("/api/workspace-code/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (data.code) setWorkspaceCode(data.code);
    } catch (err) {
      console.error("Failed to fetch workspace code:", err);
    } finally {
      setWorkspaceCodeLoading(false);
    }
  }

  useEffect(() => {
    if (authUser && !workspaceCode) {
      void fetchWorkspaceCode();
    }
  }, [authUser]);

  // Skip payment (temporary — for teacher demo)
  function handleSkipPayment() {
    if (!authUser) {
      setAuthMode("signup");
      setAuthNotice("");
      setScreen("auth");
      return;
    }
    setScreen("app");
    // Auto-fetch workspace code when entering the app
    void fetchWorkspaceCode();
  }

  async function handleCheckout() {
    if (checkoutBusy) return;

    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      // Choose API endpoint based on payment category
      const isInternational = paymentCategory === "international";
      const endpoint = isInternational ? "/api/checkout/gammaltech" : "/api/checkout";
      const payload = isInternational
        ? {
            plan: selectedPlan,
            billingCycle,
            currency: internationalCurrency,
            card: internationalCard,
          }
        : {
            plan: selectedPlan,
            billingCycle,
            locale,
            paymentMethod: nationalCard,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { checkoutUrl?: string; checkout_url?: string; url?: string; error?: string; message?: string } =
        await response.json().catch(() => ({}));
      const redirectUrl = data.checkoutUrl ?? data.checkout_url ?? data.url;
      if (response.ok && redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }
      setCheckoutError(data.error ?? data.message ?? t("Could not start the payment. Please try again."));
    } catch {
      setCheckoutError(t("Network error. Please check your connection and try again."));
    } finally {
      setCheckoutBusy(false);
    }
  }

  const navItems: { label: View; icon: string }[] = [
    { label: "Dashboard", icon: "dashboard" },
    { label: "Clients", icon: "clients" },
    { label: "Messages", icon: "message" },
    { label: "Documents", icon: "fileStack" },
    { label: "Settings", icon: "settings" },
  ];

  const publicHeader = (
    <header className="public-header">
      <a className="public-brand" href="#" onClick={(event) => { event.preventDefault(); setScreen("landing"); }} aria-label="CountaDocs home">
        <span className="brand-mark"><Image alt="" height={1315} priority src="/countadocs-mark.png" unoptimized width={1600} /></span>
        <span>Counta<strong>Docs</strong></span>
      </a>
      <nav className="public-nav" aria-label="Main navigation">
        <span>{t("Documents without the digging")}</span><span>{t("Gentle client follow-ups")}</span><span>{t("A clear picture of every task")}</span>
      </nav>
      <div className="public-actions">
        <label className="language-picker">
          <span className="language-globe"><Icon name="globe" size={16} /></span>
          <select aria-label="Language / Langue / اللغة" onChange={(event) => setLocale(event.target.value as Locale)} value={locale}>
            <option value="en">EN</option><option value="fr">FR</option><option value="ar">عربي</option>
          </select>
        </label>
        <button className="public-signin" onClick={() => { setAuthMode("login"); setAuthNotice(""); setScreen("auth"); }} type="button">{t("Sign in")}</button>
        <button className="primary-button" onClick={() => setScreen("plans")} type="button">{t("Get started")} <Icon name="chevron" size={15} /></button>
      </div>
    </header>
  );

  if (screen === "plans" || screen === "checkout") {
    const isCheckout = screen === "checkout";
    return (
      <div className="public-shell subscription-shell" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
        {publicHeader}
        <main className="subscription-main">
          <nav aria-label={t("Plan & payment")} className="subscription-steps">
            <span className="step-active">{t("Step 1 · Choose a plan")}</span>
            <span className={isCheckout ? "step-active" : ""}>{t("Step 2 · Payment setup")}</span>
            <span>{t("Step 3 · Create account")}</span>
          </nav>
          {!isCheckout ? (
            <>
              <div className="subscription-heading">
                <span className="subscription-eyebrow">{t("Plan & payment")}</span>
                <h1>{t("Choose a plan for your practice")}</h1>
                <p>{t("Simple pricing for calmer client work.")}</p>
                <div aria-label={t("Billing period")} className="billing-toggle">
                  <button aria-pressed={billingCycle === "monthly"} className={billingCycle === "monthly" ? "selected" : ""} onClick={() => setBillingCycle("monthly")} type="button">{t("MONTHLY")}</button>
                  <button aria-pressed={billingCycle === "yearly"} className={billingCycle === "yearly" ? "selected" : ""} onClick={() => setBillingCycle("yearly")} type="button">{t("YEARLY")} <span>{t("Save 17%")}</span></button>
                </div>
              </div>
              <div className="plan-grid">
                {subscriptionPlans.map((plan) => {
                  const price = billingCycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
                  const isPro = plan.id === "pro";
                  return (
                    <article className={`plan-card${isPro ? " plan-card-featured" : ""}`} key={plan.id}>
                      {isPro && <div className="plan-ribbon">{t("Best value")}</div>}
                      <div className="plan-card-title"><div><span className="plan-tier">{t(plan.id === "pro" ? "Pro" : "Starter")}</span><h2>{t(isPro ? "For growing practices" : "For independent practices")}</h2></div>{!isPro && <span className="trial-tag">{t("7-day free trial")}</span>}</div>
                      <div className="plan-price"><strong>{formatPrice(price)}</strong><span>/{t(billingCycle === "monthly" ? "per month" : "per year")}</span></div>
                      {billingCycle === "yearly" && <p className="plan-saving">{t("Save 17%")} · {t("Billed annually")}</p>}
                      <ul className="plan-features">{plan.features.map((feature) => <li key={feature}><Icon name="check" size={16} />{t(feature)}</li>)}</ul>
                      <button className={isPro ? "plan-secondary-cta" : "plan-primary-cta"} onClick={() => { setSelectedPlan(plan.id); setScreen("checkout"); }} type="button">{t(isPro ? "Choose Pro" : "Start free trial")}<Icon name="chevron" size={15} /></button>
                    </article>
                  );
                })}
              </div>
              <p className="subscription-footnote">{t("Secure payment by Chargily")} · CIB / Edahabia</p>
            </>
          ) : (
            <>
              <div className="subscription-heading checkout-heading">
                <span className="subscription-eyebrow">{t("Payment method")}</span>
                <h1>{t("Confirm & Pay")}</h1>
                <p>{t("Review your plan and proceed to secure payment.")}</p>
              </div>
              <div className="checkout-grid">
                <section className="checkout-card-preview">
                  <div className="checkout-card-heading">
                    <div>
                      <h2>{t("Payment Method")}</h2>
                      <p>{t("Choose how you want to pay")}</p>
                    </div>
                    <Icon name="lock" size={19} />
                  </div>

                  {/* Category Tabs: National vs International */}
                  <div
                    className="payment-category-tabs"
                    role="tablist"
                    style={{
                      display: "flex",
                      background: "#F0F4F1",
                      border: "1px solid #DFE6E0",
                      borderRadius: "8px",
                      padding: "4px",
                      gap: "6px",
                      margin: "16px 0 16px",
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={paymentCategory === "national"}
                      className={`payment-tab-btn ${paymentCategory === "national" ? "active" : ""}`}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        height: "40px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: paymentCategory === "national" ? "#FFFFFF" : "#4B6358",
                        background: paymentCategory === "national" ? "#1E6543" : "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        boxShadow: paymentCategory === "national" ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                        transition: "all 0.15s ease",
                      }}
                      onClick={() => {
                        setPaymentCategory("national");
                        setCheckoutError("");
                      }}
                    >
                      <AlgeriaFlag width={20} height={14} />
                      <span>{t("National")}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={paymentCategory === "international"}
                      className={`payment-tab-btn ${paymentCategory === "international" ? "active" : ""}`}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        height: "40px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: paymentCategory === "international" ? "#FFFFFF" : "#4B6358",
                        background: paymentCategory === "international" ? "#1E6543" : "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        boxShadow: paymentCategory === "international" ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                        transition: "all 0.15s ease",
                      }}
                      onClick={() => {
                        setPaymentCategory("international");
                        setCheckoutError("");
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center" }}><Icon name="globe" size={16} /></span>
                      <span>{t("International")}</span>
                    </button>
                  </div>

                  {paymentCategory === "national" ? (
                    <>
                      <p style={{ fontSize: "13px", fontWeight: 600, color: "#1C3326", margin: "0 0 10px" }}>
                        {t("Select your Algerian card:")}
                      </p>
                      <div
                        className="payment-methods-grid national-grid"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: "12px",
                          marginBottom: "16px",
                        }}
                      >
                        <button
                          type="button"
                          className={`payment-method-card ${nationalCard === "edahabia" ? "selected" : ""}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "14px",
                            borderRadius: "10px",
                            border: nationalCard === "edahabia" ? "2px solid #1E6543" : "1.5px solid #E2E8E2",
                            background: nationalCard === "edahabia" ? "#F2F8F4" : "#FFFFFF",
                            cursor: "pointer",
                            textAlign: locale === "ar" ? "right" : "left",
                            width: "100%",
                            boxSizing: "border-box",
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => setNationalCard("edahabia")}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "10px" }}>
                            <span
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: nationalCard === "edahabia" ? "2px solid #1E6543" : "1.5px solid #CCD5CE",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {nationalCard === "edahabia" && (
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1E6543" }} />
                              )}
                            </span>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "3px 8px",
                                borderRadius: "5px",
                                fontSize: "11px",
                                fontWeight: 800,
                                color: "#165A36",
                                background: "#E3F3EA",
                                border: "1px solid #B8E2C9",
                                letterSpacing: "0.2px",
                              }}
                            >
                              <Icon name="card" size={13} /> EDAHABIA
                            </span>
                          </div>
                          <strong style={{ fontSize: "14px", fontWeight: 700, color: "#163826", margin: "2px 0 0" }}>{t("EDAHABIA")}</strong>
                          <span style={{ fontSize: "12px", color: "#475E51", marginTop: "2px" }}>{t("Edahabia Card")}</span>
                          <small style={{ fontSize: "11px", color: "#7A8F83", marginTop: "3px" }}>{t("Algérie Poste")}</small>
                        </button>

                        <button
                          type="button"
                          className={`payment-method-card ${nationalCard === "cib" ? "selected" : ""}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "14px",
                            borderRadius: "10px",
                            border: nationalCard === "cib" ? "2px solid #1E6543" : "1.5px solid #E2E8E2",
                            background: nationalCard === "cib" ? "#F2F8F4" : "#FFFFFF",
                            cursor: "pointer",
                            textAlign: locale === "ar" ? "right" : "left",
                            width: "100%",
                            boxSizing: "border-box",
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => setNationalCard("cib")}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "10px" }}>
                            <span
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: nationalCard === "cib" ? "2px solid #1E6543" : "1.5px solid #CCD5CE",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {nationalCard === "cib" && (
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1E6543" }} />
                              )}
                            </span>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "3px 8px",
                                borderRadius: "5px",
                                fontSize: "11px",
                                fontWeight: 850,
                                color: "#185B94",
                                background: "#E8F2FA",
                                border: "1px solid #C4DFF5",
                              }}
                            >
                              CIB
                            </span>
                          </div>
                          <strong style={{ fontSize: "14px", fontWeight: 700, color: "#163826", margin: "2px 0 0" }}>{t("CIB")}</strong>
                          <span style={{ fontSize: "12px", color: "#475E51", marginTop: "2px" }}>{t("CIB Card")}</span>
                          <small style={{ fontSize: "11px", color: "#7A8F83", marginTop: "3px" }}>{t("Algerian Bank Card")}</small>
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          borderRadius: "7px",
                          background: "#E8F4EA",
                          border: "1px solid #A3D4B3",
                          color: "#163F30",
                          fontSize: "12px",
                          lineHeight: 1.5,
                          margin: "14px 0",
                        }}
                        role="note"
                      >
                        <Icon name="lock" size={16} />
                        <span>{t("You will be securely redirected to Chargily Pay to pay with your selected card.")}</span>
                      </div>

                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: "16px 0 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "11px",
                        }}
                      >
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Works with any Edahabia or CIB card")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Protected by Algerian bank SMS OTP verification")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Instant workspace activation upon successful payment")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t(billingCycle === "monthly" ? "One-time payment for 1 month (no automatic recurring charges)" : "One-time payment for 1 year (no automatic recurring charges)")}</span>
                        </li>
                      </ul>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          margin: "0 0 12px",
                        }}
                      >
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#1C3326", margin: 0 }}>
                          {t("Select your international payment method:")}
                        </p>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            background: "#F0F4F1",
                            border: "1px solid #DFE6E0",
                            borderRadius: "6px",
                            padding: "2px",
                            gap: "2px",
                          }}
                          aria-label="Currency"
                        >
                          <button
                            type="button"
                            style={{
                              border: "none",
                              background: internationalCurrency === "USD" ? "#1E6543" : "transparent",
                              color: internationalCurrency === "USD" ? "#FFFFFF" : "#4B6358",
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "4px 9px",
                              borderRadius: "4px",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                            onClick={() => setInternationalCurrency("USD")}
                          >
                            $ USD
                          </button>
                          <button
                            type="button"
                            style={{
                              border: "none",
                              background: internationalCurrency === "EUR" ? "#1E6543" : "transparent",
                              color: internationalCurrency === "EUR" ? "#FFFFFF" : "#4B6358",
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "4px 9px",
                              borderRadius: "4px",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                            onClick={() => setInternationalCurrency("EUR")}
                          >
                            € EUR
                          </button>
                        </div>
                      </div>

                      <div
                        className="payment-methods-grid international-grid"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          gap: "10px",
                          marginBottom: "16px",
                        }}
                      >
                        <button
                          type="button"
                          className={`payment-method-card ${internationalCard === "visa" ? "selected" : ""}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "12px 10px",
                            borderRadius: "10px",
                            border: internationalCard === "visa" ? "2px solid #1E6543" : "1.5px solid #E2E8E2",
                            background: internationalCard === "visa" ? "#F2F8F4" : "#FFFFFF",
                            cursor: "pointer",
                            textAlign: locale === "ar" ? "right" : "left",
                            width: "100%",
                            boxSizing: "border-box",
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => setInternationalCard("visa")}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "8px" }}>
                            <span
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: internationalCard === "visa" ? "2px solid #1E6543" : "1.5px solid #CCD5CE",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {internationalCard === "visa" && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1E6543" }} />}
                            </span>
                            <span style={{ fontSize: "14px", fontWeight: 900, fontStyle: "italic", color: "#1A1F71" }}>VISA</span>
                          </div>
                          <strong style={{ fontSize: "13px", fontWeight: 700, color: "#163826", margin: "2px 0 0" }}>{t("VISA")}</strong>
                          <span style={{ fontSize: "11px", color: "#475E51", marginTop: "2px" }}>{t("Visa Card")}</span>
                          <small style={{ fontSize: "10px", color: "#7A8F83", marginTop: "3px" }}>{t("Credit or Debit")}</small>
                        </button>

                        <button
                          type="button"
                          className={`payment-method-card ${internationalCard === "mastercard" ? "selected" : ""}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "12px 10px",
                            borderRadius: "10px",
                            border: internationalCard === "mastercard" ? "2px solid #1E6543" : "1.5px solid #E2E8E2",
                            background: internationalCard === "mastercard" ? "#F2F8F4" : "#FFFFFF",
                            cursor: "pointer",
                            textAlign: locale === "ar" ? "right" : "left",
                            width: "100%",
                            boxSizing: "border-box",
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => setInternationalCard("mastercard")}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "8px" }}>
                            <span
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: internationalCard === "mastercard" ? "2px solid #1E6543" : "1.5px solid #CCD5CE",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {internationalCard === "mastercard" && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1E6543" }} />}
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <span style={{ width: "13px", height: "13px", borderRadius: "50%", background: "#EB001B", display: "inline-block" }} />
                              <span style={{ width: "13px", height: "13px", borderRadius: "50%", background: "#F79E1B", marginLeft: "-5px", display: "inline-block", opacity: 0.95 }} />
                            </span>
                          </div>
                          <strong style={{ fontSize: "13px", fontWeight: 700, color: "#163826", margin: "2px 0 0" }}>{t("MASTERCARD")}</strong>
                          <span style={{ fontSize: "11px", color: "#475E51", marginTop: "2px" }}>{t("Mastercard")}</span>
                          <small style={{ fontSize: "10px", color: "#7A8F83", marginTop: "3px" }}>{t("Credit or Debit")}</small>
                        </button>

                        <button
                          type="button"
                          className={`payment-method-card ${internationalCard === "applepay" ? "selected" : ""}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            padding: "12px 10px",
                            borderRadius: "10px",
                            border: internationalCard === "applepay" ? "2px solid #1E6543" : "1.5px solid #E2E8E2",
                            background: internationalCard === "applepay" ? "#F2F8F4" : "#FFFFFF",
                            cursor: "pointer",
                            textAlign: locale === "ar" ? "right" : "left",
                            width: "100%",
                            boxSizing: "border-box",
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => setInternationalCard("applepay")}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "8px" }}>
                            <span
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: internationalCard === "applepay" ? "2px solid #1E6543" : "1.5px solid #CCD5CE",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {internationalCard === "applepay" && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1E6543" }} />}
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
                              <svg width="13" height="16" viewBox="0 0 814 1000" fill="#000000" aria-hidden="true" style={{ flexShrink: 0 }}>
                                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105.3-57.9-155.3-127.4C46 790.8 0 663.5 0 541.8c0-207.8 134.4-317.9 265.4-317.9 76.4 0 139.9 51 187.9 51 46 0 118.5-54.3 196.4-54.3zm-174.9-209.4c31.1-37.6 53.1-89.9 53.1-142.2 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 84.7-55.1 139.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-72.4z"/>
                              </svg>
                              <span style={{ fontWeight: 700, fontSize: "13px", color: "#000000" }}>Pay</span>
                            </span>
                          </div>
                          <strong style={{ fontSize: "13px", fontWeight: 700, color: "#163826", margin: "2px 0 0" }}>{t("Apple Pay")}</strong>
                          <span style={{ fontSize: "11px", color: "#475E51", marginTop: "2px" }}>{t("Apple Pay")}</span>
                          <small style={{ fontSize: "10px", color: "#7A8F83", marginTop: "3px" }}>{t("Express Checkout")}</small>
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          borderRadius: "7px",
                          background: "#E8F4EA",
                          border: "1px solid #A3D4B3",
                          color: "#163F30",
                          fontSize: "12px",
                          lineHeight: 1.5,
                          margin: "14px 0",
                        }}
                        role="note"
                      >
                        <Icon name="lock" size={16} />
                        <span>{t("Payments processed securely via International Gateway (Gammal Tech).")}</span>
                      </div>

                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: "16px 0 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "11px",
                        }}
                      >
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Accepts Visa, Mastercard, and Apple Pay")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Secure international 3D Secure verification")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t("Instant workspace activation upon successful payment")}</span>
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#2E4639" }}>
                          <span style={{ color: "#1E6543", display: "inline-flex", flexShrink: 0 }}>
                            <Icon name="check" size={16} />
                          </span>
                          <span>{t(billingCycle === "monthly" ? "One-time payment for 1 month (no automatic recurring charges)" : "One-time payment for 1 year (no automatic recurring charges)")}</span>
                        </li>
                      </ul>
                    </>
                  )}
                </section>

                <aside className="checkout-summary">
                  <h2>{t("Your selection")}</h2>
                  <div className="summary-plan">
                    <span>{t(selectedPlan === "pro" ? "Pro" : "Starter")}</span>
                    <strong>
                      {displayPrice}{" "}
                      <small>/{t(billingCycle === "monthly" ? "per month" : "per year")}</small>
                    </strong>
                  </div>
                  {selectedPlan === "starter" && <span className="summary-trial">{t("7-day free trial")}</span>}
                  <ul className="summary-features">
                    {activePlan.features.map((feature) => (
                      <li key={feature}><Icon name="check" size={14} />{t(feature)}</li>
                    ))}
                  </ul>
                  <button className="change-plan-button" onClick={() => setScreen("plans")} type="button">
                    {t("Change plan")}
                  </button>
                  {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                  <button
                    className="plan-primary-cta checkout-continue"
                    disabled={checkoutBusy}
                    onClick={() => void handleCheckout()}
                    type="button"
                  >
                    {checkoutBusy ? t("Please wait…") : t("Proceed to payment")}
                    <Icon name="chevron" size={15} />
                  </button>
                  <p className="checkout-no-charge">
                    {paymentCategory === "national"
                      ? t("You will review and authorize the payment on Chargily's secure checkout page.")
                      : t("You will review and authorize the payment on the secure gateway.")}
                  </p>
                  <button type="button" onClick={handleSkipPayment} style={{ marginTop: "12px", padding: "8px 20px", background: "transparent", border: "1px dashed #9CA3AF", borderRadius: "6px", color: "#6B7280", fontSize: "13px", cursor: "pointer", width: "100%" }}>{t("Skip for now (demo)")}</button>
                </aside>
              </div>
            </>
          )}
          <button className="subscription-back" onClick={() => setScreen(isCheckout ? "plans" : (authUser ? "app" : "landing"))} type="button">← {t(isCheckout ? "Back to plans" : (authUser ? "Back to workspace" : "Back to home"))}</button>
        </main>
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <div className="public-shell" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
        {publicHeader}
        <main>
          <section className="cover-hero">
            <div className="cover-copy">
              <div className="cover-eyebrow"><span /> COUNTADOCS · {t("Simple client accounting")}</div>
              <h1>{t("Your work,")}<br /><span>{t("beautifully in order.")}</span></h1>
              <p className="cover-lede">{t("Collect the papers, receipts, and tax documents your clients need to send—with a clear place for everything.")}</p>
              <div className="cover-buttons">
                <button className="cover-cta" onClick={() => setScreen("plans")} type="button">{t("Get started")} <Icon name="chevron" size={17} /></button>
                <span className="cover-note"><Icon name="check" size={15} /> {t("Simple, secure client document collection.")}</span>
              </div>
              <div className="cover-proof"><div className="proof-avatars"><span>AM</span><span>NK</span><span>+4</span></div><span>{t("Built for accountants and their clients")}</span></div>
            </div>
            <div className="cover-art" aria-label={t("Illustration of accounting papers, receipts, and tax documents")} role="img">
              <div className="cover-art-orbit orbit-one" /><div className="cover-art-orbit orbit-two" />
              <div className="floating-tag tax-tag"><span>✓</span> {t("TAX READY")}</div>
              <div className="floating-tag books-tag"><Icon name="file" size={15} /> {t("BOOKKEEPING")}</div>
              <svg className="paper-illustration" viewBox="0 0 590 480" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="304" cy="424" rx="218" ry="24" fill="#163F30" opacity=".11" />
                <rect x="115" y="85" width="265" height="322" rx="20" transform="rotate(-11 115 85)" fill="#D4E6D9" />
                <rect x="136" y="76" width="265" height="322" rx="20" transform="rotate(-5 136 76)" fill="#FBFCF7" stroke="#DFEAE0" strokeWidth="2" />
                <rect x="166" y="108" width="52" height="52" rx="14" fill="#E3F1E7" />
                <path d="M180 134h24m-24 9h18m-18-18h24" stroke="#25865D" strokeWidth="3" strokeLinecap="round" />
                <rect x="237" y="116" width="110" height="10" rx="5" fill="#294638" />
                <rect x="237" y="136" width="83" height="7" rx="3.5" fill="#B3C5B8" />
                <rect x="166" y="183" width="204" height="1.5" fill="#E8EEE7" />
                <rect x="166" y="207" width="101" height="8" rx="4" fill="#D2DDD3" />
                <rect x="166" y="226" width="166" height="7" rx="3.5" fill="#E6ECE5" />
                <rect x="166" y="243" width="147" height="7" rx="3.5" fill="#E6ECE5" />
                <rect x="166" y="278" width="204" height="82" rx="12" fill="#F0F6EF" />
                <rect x="182" y="299" width="65" height="7" rx="3.5" fill="#AFC2B2" />
                <rect x="182" y="317" width="120" height="8" rx="4" fill="#27865E" />
                <rect x="182" y="336" width="90" height="6" rx="3" fill="#CEDBCF" />
                <rect x="283" y="147" width="218" height="270" rx="19" fill="#FFFFFF" stroke="#E5EDE5" strokeWidth="2" />
                <rect x="306" y="171" width="48" height="48" rx="14" fill="#E8F4EA" />
                <path d="M320 184h17v22h-17z" stroke="#217A54" strokeWidth="2.5" strokeLinejoin="round" /><path d="M324 191h9m-9 5h9" stroke="#217A54" strokeWidth="2" strokeLinecap="round" />
                <rect x="367" y="180" width="105" height="9" rx="4.5" fill="#294638" /><rect x="367" y="199" width="75" height="6" rx="3" fill="#B8C8BA" />
                <rect x="306" y="243" width="172" height="1.5" fill="#E9EFE8" />
                <rect x="307" y="263" width="72" height="7" rx="3.5" fill="#AFC0B1" /><rect x="417" y="263" width="55" height="7" rx="3.5" fill="#AFC0B1" />
                <rect x="307" y="283" width="94" height="6" rx="3" fill="#DDE6DE" /><rect x="424" y="283" width="48" height="6" rx="3" fill="#DDE6DE" />
                <rect x="307" y="303" width="78" height="6" rx="3" fill="#DDE6DE" /><rect x="424" y="303" width="48" height="6" rx="3" fill="#DDE6DE" />
                <rect x="307" y="323" width="94" height="6" rx="3" fill="#DDE6DE" /><rect x="424" y="323" width="48" height="6" rx="3" fill="#DDE6DE" />
                <rect x="307" y="350" width="165" height="42" rx="10" fill="#E9F4E9" />
                <path d="m322 369 8 8 15-17" stroke="#24845C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="352" y="366" width="93" height="7" rx="3.5" fill="#8EB39A" />
                <circle cx="456" cy="121" r="25" fill="#24845C" /><path d="m445 121 7 7 14-15" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M100 383c34 14 56 14 78 3m332-21c-17 16-34 20-54 15" stroke="#7BA489" strokeWidth="3" strokeLinecap="round" opacity=".55" />
              </svg>
              <div className="cover-art-caption"><span className="caption-spark">✳</span><div><strong>{t("Every document, accounted for.")}</strong><span>{t("Tax forms · receipts · statements")}</span></div></div>
            </div>
          </section>
          <section className="cover-features">
            <div className="features-heading"><span>{t("BUILT FOR THE WORK BEHIND THE NUMBERS")}</span><h2>{t("Everything your paperwork needs.")}</h2></div>
            <div className="feature-grid">
              <article className="feature-card"><span className="feature-icon"><Icon name="file" size={20} /></span><h3>{t("Documents without the digging")}</h3><p>{t("Keep tax forms, receipts, and statements together for each client.")}</p></article>
              <article className="feature-card"><span className="feature-icon"><Icon name="nudgeBell" size={20} /></span><h3>{t("Gentle client follow-ups")}</h3><p>{t("See what’s missing and nudge clients when documents are due.")}</p></article>
              <article className="feature-card"><span className="feature-icon"><Icon name="dashboard" size={20} /></span><h3>{t("A clear picture of every task")}</h3><p>{t("Track tax prep, bookkeeping, and payroll requests at a glance.")}</p></article>
            </div>
          </section>
        </main>
        <footer className="public-footer"><a className="public-brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark"><Image alt="" height={1315} priority src="/countadocs-mark.png" unoptimized width={1600} /></span><span>Counta<strong>Docs</strong></span></a><span>{t("Secure document collection for accounting teams.")}</span><span>© 2026 CountaDocs</span></footer>
      </div>
    );
  }

  if (screen === "auth") {
    return (
      <div className="auth-shell" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
        <header className="auth-header">
          <a className="public-brand" href="#" onClick={(event) => { event.preventDefault(); setScreen("landing"); }}><span className="brand-mark"><Image alt="" height={1315} priority src="/countadocs-mark.png" unoptimized width={1600} /></span><span>Counta<strong>Docs</strong></span></a>
          <div className="public-actions">
            <label className="language-picker"><span className="language-globe"><Icon name="globe" size={16} /></span><select aria-label="Language / Langue / اللغة" onChange={(event) => setLocale(event.target.value as Locale)} value={locale}><option value="en">EN</option><option value="fr">FR</option><option value="ar">عربي</option></select></label>
            <button className="back-home" onClick={() => setScreen("landing")} type="button">← {t("Back to home")}</button>
          </div>
        </header>
        <main className="auth-main">
          <aside className="auth-aside">
            <div className="auth-aside-art"><Icon name="file" size={54} /><span>+</span><Icon name="check" size={30} /></div>
            <p className="auth-kicker">{t("COUNTADOCS · YOUR ACCOUNTING WORKSPACE")}</p>
            <h1>{t("Your work,")}<br />{t("beautifully in order.")}</h1>
            <p>{t("Bookkeeping, tax documents, and client requests—organized in one calm workspace.")}</p>
            <div className="auth-paper-note"><Icon name="check" size={17} /> {t("Tax forms · Receipts · Statements")}</div>
          </aside>
          <section className="auth-card">
            <div className="auth-card-heading">
              <span className="auth-card-mark"><Icon name={authMode === "signup" ? "plus" : "clients"} size={19} /></span>
              <h2>{t(authMode === "signup" ? "Create your workspace" : authMode === "reset" ? "Set a new password" : "Welcome back")}</h2>
              <p>{t(authMode === "signup" ? "Enter your email and we’ll send a sign-up link to create your account." : authMode === "reset" ? "Choose a new password." : "Sign in to your accounting workspace.")}</p>
            </div>
            {authMode !== "reset" && (
              <>
                <button className="google-button" disabled={authBusy} onClick={startGoogleSignIn} type="button"><svg aria-hidden="true" className="google-g" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" /><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 015.5 12c0-.73.12-1.43.34-2.1V7.06H2.18A11 11 0 001 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.73 1 4.09 3.44 2.25 7.01l3.66 2.84C6.77 6.99 9.2 5.38 12 5.38z" /></svg>{t("Continue with Google")}</button>
                <div className="auth-divider"><span>{t("Or continue with email")}</span></div>
              </>
            )}
            <form className="auth-form" onSubmit={submitSupabaseAuth}>
              {authMode === "reset" ? (
                <label>{t("Password")}<span className="password-field"><input aria-invalid={authPassword.length > 0 && !authPasswordValid} autoComplete="new-password" minLength={6} onChange={(event) => { setAuthPassword(event.target.value); setAuthNotice(""); }} pattern="(?=.*[0-9])(?=.*[^A-Za-z0-9\s])\S{6,}" placeholder={t("Choose a new password.")} required title={t("At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /")} type={showAuthPassword ? "text" : "password"} value={authPassword} /><button aria-label={t(showAuthPassword ? "Hide password" : "Show password")} className="password-visibility" onClick={() => setShowAuthPassword(!showAuthPassword)} type="button"><Icon name={showAuthPassword ? "eyeOff" : "eye"} size={16} /></button></span><span aria-live="polite" className={`auth-help${authPassword.length > 0 && !authPasswordValid ? " invalid" : ""}`}>{t("At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /")}</span></label>
              ) : (
                <>
                  <label>{t("Email address")}<input aria-invalid={authIdentifier.length > 0 && !authEmailValid} autoComplete="email" onChange={(event) => { setAuthIdentifier(event.target.value); setAuthNotice(""); }} pattern={"[^@ ]+@[^@ ]+\\.[^@ ]{2,}"} placeholder="user@domain.com" required title={t("Enter a valid email address.")} type="email" value={authIdentifier} />{authMode === "signup" && <span aria-live="polite" className={`auth-help${authIdentifier.length > 0 && !authEmailValid ? " invalid" : ""}`}>{t("Enter a valid email address.")}</span>}</label>
                  {authMode === "login" && (
                    <label>{t("Password")}<span className="password-field"><input aria-invalid={authPassword.length > 0 && !authPasswordValid} autoComplete="current-password" minLength={6} onChange={(event) => { setAuthPassword(event.target.value); setAuthNotice(""); }} pattern="(?=.*[0-9])(?=.*[^A-Za-z0-9\s])\S{6,}" placeholder="••••••••" required title={t("At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /")} type={showAuthPassword ? "text" : "password"} value={authPassword} /><button aria-label={t(showAuthPassword ? "Hide password" : "Show password")} className="password-visibility" onClick={() => setShowAuthPassword(!showAuthPassword)} type="button"><Icon name={showAuthPassword ? "eyeOff" : "eye"} size={16} /></button></span><span aria-live="polite" className={`auth-help${authPassword.length > 0 && !authPasswordValid ? " invalid" : ""}`}>{t("At least 6 characters, 1 number, 1 symbol. Examples: .   ,   @   /")}</span></label>
                  )}
                </>
              )}
              {authMode !== "reset" && <button className="auth-forgot" disabled={authBusy} onClick={() => void sendPasswordReset()} type="button">{t("Forgot your password?")}</button>}
              {authNotice && <p className={`auth-notice${[t("A sign-up link is on its way. Check your email to finish creating your account."), t("Password reset link sent. Check your email.")].includes(authNotice) ? " success" : ""}`} role="status">{authNotice}</p>}
              <button className="auth-submit" disabled={authBusy || !authFormValid} type="submit">{t(authBusy ? "Please wait…" : authMode === "reset" ? "Set a new password" : authMode === "signup" ? "Email me a sign-up link" : "Sign in")}</button>
            </form>
            {authMode === "reset" ? (
              <p className="auth-switch"><button onClick={() => { recoveryRef.current = false; setAuthMode("login"); setAuthPassword(""); setAuthNotice(""); }} type="button">{t("Sign in")}</button></p>
            ) : (
              <p className="auth-switch">{t(authMode === "signup" ? "Already have an account?" : "Don't have an account?")} <button onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthPassword(""); setAuthNotice(""); }} type="button">{t(authMode === "signup" ? "Log in" : "Sign up")}</button></p>
            )}
            <p className="auth-disclaimer">{t("Authentication is powered by Supabase.")}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView("Dashboard"); }}>
          <span className="brand-mark"><Image alt="" height={1315} priority src="/countadocs-mark.png" unoptimized width={1600} /></span>
          <span>Counta<strong>Docs</strong></span>
        </a>
        <div className="workspace-label">{t("WORKSPACE")}</div>
        <nav className="side-nav" aria-label={t("Main navigation")}>
          {navItems.map((item) => (
            <button aria-label={localizedView(item.label)} className={`nav-item${view === item.label ? " active" : ""}`} key={item.label} onClick={() => { setView(item.label); setSearch(""); setSelectedClientId(null); setDocumentClientId(null); setSelectedDocumentId(null); if (item.label === "Messages" && !selectedMessageClientId && clients[0]?.id) openConversation(clients[0].id); }} type="button">
              <Icon name={item.icon} /><span>{localizedView(item.label)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon"><Icon name="file" size={16} /></div>
            <strong>{t("Free workspace")}</strong>
            <span>{clients.length} / 10 {t("client spaces used")}</span>
            <div className="plan-track"><span style={{ width: `${Math.min(clients.length / 10 * 100, 100)}%` }} /></div>
            <button type="button" onClick={() => setScreen("plans")}>{t("Manage plan")} <Icon name="chevron" size={14} /></button>
          </div>
          <div className="sidebar-profile">
            <ProfileAvatar className="avatar-dark" imageUrl={profileImage} key={profileImage} name={profileName} />
            <div className="profile-copy"><strong>{profileName}</strong><span>{profileAccountType}</span></div>
            <button aria-label={t("Open profile settings")} type="button" onClick={() => setView("Settings")}><Icon name="more" /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>{t("Workspace")}</span><Icon name="chevron" size={14} /><strong>{localizedView(view)}</strong></div>
          <div className="topbar-actions">
            <label className="language-picker">
              <span className="language-globe"><Icon name="globe" size={16} /></span>
              <select aria-label="Language / Langue / اللغة" onChange={(event) => setLocale(event.target.value as Locale)} value={locale}>
                <option value="en">EN</option>
                <option value="fr">FR</option>
                <option value="ar">عربي</option>
              </select>
            </label>
            {/* The bell is ALWAYS rendered. Clicking it opens the popover, which shows
                loading / error / list / "You are all caught up!" depending on state.
                A red dot (notification-dot) shows while any notification is unread. */}
            <div className="notification-wrap" ref={notificationRef}>
              <button
                aria-expanded={showNotifications}
                aria-haspopup="true"
                aria-label={unreadCount > 0 ? `${t("Notifications")}: ${unreadCount}` : t("Notifications")}
                className="icon-button notification-button"
                onClick={() => setShowNotifications((open) => !open)}
                type="button"
              >
                <span aria-hidden="true" className="notification-icon">
                  <BellIcon
                    className={`notification-bell${bellAnimationVersion > 0 ? " notification-bell-ring" : ""}`}
                    key={bellAnimationVersion}
                    ringing={unreadCount > 0}
                  />
                  {unreadCount > 0 && <span aria-hidden="true" className="notification-dot" />}
                </span>
              </button>
              {showNotifications && (
                <div className="notification-popover">
                  <div className="notification-popover-header">
                    <strong>{t("Notifications")}</strong>
                    {notifications.length > 0 && (
                      <button
                        disabled={unreadCount === 0}
                        onClick={() => markNotificationsAsRead()}
                        type="button"
                      >
                        {t("Mark all as read")}
                      </button>
                    )}
                  </div>
                  {realtimeError && <p className="notification-error" role="status">{realtimeError}</p>}
                  {notificationsLoading ? (
                    <p className="notification-status">{t("Loading notifications…")}</p>
                  ) : notificationError ? (
                    <p className="notification-error" role="alert">{notificationError}</p>
                  ) : notifications.length > 0 ? (
                    <div className="notification-list">
                      {notifications.map((notification) => (
                        <button
                          aria-label={`${notification.title}: ${notification.clientName} · ${notification.body}`}
                          className={`notification-item${notification.read ? "" : " unread"}`}
                          key={notification.id}
                          onClick={() => {
                            markNotificationsAsRead(notification.id);
                            setView("Documents");
                            setDocumentClientId(notification.clientId);
                            setSelectedDocumentId(notification.documentId);
                            setDocumentSearch("");
                            setDocumentCategory("all");
                            setShowNotifications(false);
                          }}
                          type="button"
                        >
                          <span className="notification-item-copy">
                            <strong>{t(notification.title)}</strong>
                            <span>{notification.documentId ? notification.body : `${notification.clientName} · ${notification.body}`}</span>
                          </span>
                          <time dateTime={notification.createdAt}>{formatRelativeTime(notification.createdAt, locale)}</time>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="notification-empty">
                      <strong>{t("You are all caught up!")}</strong>
                      <span>{t("Clients documents will show here.")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowConnectClientsModal(true);
                if (!workspaceCode) void fetchWorkspaceCode();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                background: "#FFFFFF",
                color: "#166534",
                border: "none",
                borderRadius: "9999px",
                padding: "7px 16px",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3z" />
                <path d="M17 17h4v4h-4z" />
                <path d="M14 20h3" />
                <path d="M20 14v3" />
              </svg>
              <span style={{ width: "1px", height: "16px", background: "#166534", opacity: 0.35 }} />
              <span>{t("Connect Clients")}</span>
            </button>
            <button aria-label={t("Open profile settings")} className="top-profile flex items-center gap-2" onClick={() => setView("Settings")} type="button">
              <ProfileAvatar className="avatar-photo" imageUrl={profileImage} key={profileImage} name={profileName} /><span>{profileName}</span><span className="down-chevron">⌄</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          {view === "Dashboard" && (
            <>
              <div className="page-title-row">
                <div><div className="date-eyebrow">{t("YOUR ACCOUNTING WORKSPACE")}</div><h1>{t(greeting)}, <span className="greeting-name">{profileName}</span></h1><p className="page-subtitle">{t("Here’s what’s happening with your client documents.")}</p></div>
                <button className="primary-button" onClick={() => { setFormError(""); setShowRequestForm(true); }} type="button"><Icon name="plus" size={17} /> {t("New request")}</button>
              </div>

              <section className="stats-grid" aria-label={t("Workspace overview")}>
                <article className="stat-card"><div className="stat-top"><span>{t("Active requests")}</span><span className="stat-icon teal"><Icon name="file" size={17} /></span></div><strong>{String(requests.length).padStart(2, "0")}</strong><div className="stat-foot"><span className="stat-positive">+2</span> {t("from last month")}</div></article>
                <article className="stat-card"><div className="stat-top"><span>{t("Pending uploads")}</span><span className="stat-icon amber"><Icon name="clock" size={17} /></span></div><strong>22</strong><div className="stat-foot"><span>{t("Across")} </span><b>{t("4 clients")}</b></div></article>
                <article className="stat-card"><div className="stat-top"><span>{t("Documents received")}</span><span className="stat-icon blue"><Icon name="check" size={17} /></span></div><strong>{String(documents.length).padStart(2, "0")}</strong><div className="stat-foot">{t("Across")} <b>{clients.length} {t("clients")}</b></div></article>
                <article className="stat-card"><div className="stat-top"><span>{t("Waiting on clients")}</span><span className="stat-icon violet"><Icon name="clients" size={17} /></span></div><strong>03</strong><div className="stat-foot"><span>{t("Needs your attention")}</span></div></article>
              </section>

              <section className="content-card requests-card">
                <div className="card-heading">
                  <div><h2>{t("Client document requests")}</h2><p>{t("Keep your client work moving forward.")}</p></div>
                  <button className="text-button" onClick={() => { setSearch(""); setTab("requests"); }} type="button">{t("View all")} <Icon name="chevron" size={15} /></button>
                </div>
                <div className="tabs" role="tablist" aria-label={t("Document activity")}>
                  <button aria-selected={tab === "requests"} className={`tab${tab === "requests" ? " selected" : ""}`} onClick={() => setTab("requests")} role="tab" type="button">{t("Active requests")} <span className="tab-count">{String(requests.length).padStart(2, "0")}</span></button>
                  <button aria-selected={tab === "uploads"} className={`tab${tab === "uploads" ? " selected" : ""}`} onClick={() => setTab("uploads")} role="tab" type="button">{t("Pending uploads")} <span className="tab-count">22</span></button>
                </div>
                {tab === "requests" ? (
                  <div className="request-list">
                    {filteredRequests.length ? filteredRequests.map((request) => (
                      <article className="request-row" key={request.id}>
                        <div className="request-main"><div className={`client-avatar ${request.id % 4 === 0 ? "avatar-amber" : request.id % 3 === 0 ? "avatar-violet" : request.id % 2 === 0 ? "avatar-blue" : "avatar-teal"}`}>{request.client.split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}</div>
                          <div className="request-copy"><h3>{request.client} <span className="request-divider">·</span> {t(request.service)}</h3>{request.detail && <span className="request-detail">{request.detail}</span>}<div className="request-status"><span className={`status-dot ${request.status === "Reminder sent" ? "reminder" : ""}`} />{t(request.status)}</div></div>
                        </div>
                        <div className="request-progress"><div className="progress-label"><span>{request.progress}% {t("complete")}</span><button aria-label={`${t("More options for")} ${request.client}`} className="row-more" type="button"><Icon name="more" size={17} /></button></div><ProgressBar label={`${request.progress}% ${t("complete")}`} value={request.progress} /></div>
                        <button aria-label={`${t("Open")} ${request.client} ${t("request")}`} className="row-chevron" onClick={() => { setView("Clients"); setSearch(request.client); }} type="button"><Icon name="chevron" size={19} /></button>
                      </article>
                    )) : <div className="empty-state">{t("No requests match")} “{search}”.</div>}
                  </div>
                ) : (
                  <div className="uploads-list">
                    {filteredUploads.length ? filteredUploads.map((upload) => (
                      <article className="upload-row" key={upload.file}>
                        <span className="upload-icon"><Icon name="file" size={19} /></span>
                        <div className="upload-copy"><strong>{upload.file}</strong><span>{upload.client} <span className="request-divider">·</span> {t(upload.date)}</span></div>
                        <span className="upload-kind">{t(upload.kind)}</span>
                        <button className="review-button" onClick={() => setView("Clients")} type="button">{t("Review file")} <Icon name="chevron" size={14} /></button>
                      </article>
                    )) : <div className="empty-state">{t("No uploads match")} “{search}”.</div>}
                  </div>
                )}
                <div className="card-footer"><span>{t("Showing")} {tab === "requests" ? filteredRequests.length : filteredUploads.length} {t(tab === "requests" ? "active requests" : "recent uploads")}</span><button onClick={() => { setTab(tab === "requests" ? "uploads" : "requests"); setSearch(""); }} type="button">{t(tab === "requests" ? "See all activity" : "Active requests")} <Icon name="chevron" size={14} /></button></div>
              </section>

              <div className="bottom-grid">
                <section className="content-card activity-card"><div className="card-heading"><div><h2>{t("Recent activity")}</h2><p>{t("The latest updates from your workspace.")}</p></div><button className="icon-button subtle-icon" aria-label={t("More activity options")} type="button"><Icon name="more" /></button></div>
                  <div className="activity-list">
                    <div className="activity-item"><span className="activity-symbol activity-upload"><Icon name="upload" size={15} /></span><div><p><strong>ABC Corp</strong> {t("uploaded")} {t("Bank statement")} — September</p><span>{t("12 minutes ago")}</span></div></div>
                    <div className="activity-item"><span className="activity-symbol activity-reminder"><Icon name="clock" size={15} /></span><div><p>{t("Reminder sent to")} <strong>Beta Tech</strong></p><span>{t("1 hour ago")}</span></div></div>
                    <div className="activity-item"><span className="activity-symbol activity-complete"><Icon name="check" size={15} /></span><div><p><strong>Gamma Inc</strong> {t("completed")} {t("Payroll documents")}</p><span>{t("Yesterday")}</span></div></div>
                  </div>
                </section>
                <section className="tip-card"><span className="tip-decoration">✳</span><div className="tip-label">{t("A LITTLE TIP")}</div><h2>{t("Less chasing,")}<br />{t("more accounting.")}</h2><p>{t("Set up a request template once and reuse it for every client.")}</p><button onClick={() => setView("Templates")} type="button">{t("Explore templates")} <Icon name="chevron" size={15} /></button><div className="tip-lines" /></section>
              </div>
            </>
          )}

          {view === "Messages" && (
            <>
              <div className="page-title-row">
                <div>
                  <div className="date-eyebrow">{t("YOUR WORKSPACE")}</div>
                  <h1>{t("Messages")}</h1>
                  <p className="page-subtitle">{t("Keep client conversations and document coordination together.")}</p>
                </div>
              </div>
              {messagesError && (
                <div className="messages-error" role="alert">
                  <span>{messagesError}</span>
                  {!clientsLoading || clientsLoadFailed ? (
                    <button
                      onClick={() => {
                        setMessagesError("");
                        setClientsLoadFailed(false);
                        setWorkspaceLoadAttempt((attempt) => attempt + 1);
                      }}
                      type="button"
                    >
                      {t("Retry")}
                    </button>
                  ) : null}
                </div>
              )}
              {messageSchemaNotice && (
                <p className="message-schema-notice" role="status">{t(messageSchemaNotice)}</p>
              )}
              <section aria-label={t("Client conversations")} className="messages-workspace">
                <aside className="messages-sidebar">
                  <div className="messages-sidebar-heading">
                    <h2>{t("Client conversations")}</h2>
                    <span>{clients.length}</span>
                  </div>
                  <label className="messages-search">
                    <Icon name="search" size={16} />
                    <input
                      aria-label={t("Search conversations...")}
                      onChange={(event) => setMessageSearch(event.target.value)}
                      placeholder={t("Search conversations...")}
                      type="search"
                      value={messageSearch}
                    />
                  </label>
                  <div className="messages-conversation-list">
                    {clientsLoading && !clientsLoadFailed ? (
                      <div aria-label={t("Loading conversations…")} className="messages-list-skeleton" role="status">
                        {Array.from({ length: 4 }, (_, index) => (
                          <div className="messages-skeleton-row" key={`conversation-skeleton-${index}`}>
                            <span className="messages-skeleton-avatar" />
                            <span className="messages-skeleton-copy"><i /><i /></span>
                          </div>
                        ))}
                      </div>
                    ) : clientsLoadFailed ? (
                      <p className="messages-list-empty">{t("Could not load client conversations.")}</p>
                    ) : filteredMessageClients.map((client) => {
                      if (!client.id) return null;
                      const lastMessage = latestMessageByClient.get(client.id);
                      const unread = unreadMessagesByClient.get(client.id) ?? 0;
                      return (
                        <button
                          aria-current={selectedMessageClientId === client.id ? "true" : undefined}
                          className={`messages-conversation${selectedMessageClientId === client.id ? " selected" : ""}`}
                          key={client.id}
                          onClick={() => openConversation(client.id!)}
                          type="button"
                        >
                          <span className={`messages-avatar avatar-${client.color}`}>{profileInitials(client.name)}</span>
                          <span className="messages-conversation-copy">
                            <span className="messages-conversation-title">
                              <strong>{client.name}</strong>
                              {lastMessage && <time dateTime={lastMessage.createdAt}>{formatRelativeTime(lastMessage.createdAt, locale)}</time>}
                            </span>
                            <span className="messages-conversation-preview">{lastMessage?.body ?? t("No messages yet. Send the first message.")}</span>
                          </span>
                          {unread > 0 && <span aria-label={`${unread} unread`} className="messages-unread-dot" />}
                        </button>
                      );
                    })}
                    {filteredMessageClients.length === 0 && (
                      <p className="messages-list-empty">{clients.length ? t("No conversations match your search.") : t("No clients yet.")}</p>
                    )}
                  </div>
                </aside>
                <section aria-label={selectedMessageClient?.name ?? t("Select a conversation")} className="messages-chat">
                  {selectedMessageClient ? (
                    <>
                      <header className="messages-chat-header">
                        <span className={`messages-avatar avatar-${selectedMessageClient.color}`}>{profileInitials(selectedMessageClient.name)}</span>
                        <div><strong>{selectedMessageClient.name}</strong><span>{selectedMessageClient.company}</span></div>
                      </header>
                      <div aria-live="polite" className="messages-chat-history">
                        {messagesLoading ? (
                          <p className="messages-chat-empty">{t("Loading messages…")}</p>
                        ) : messagesForSelectedClient.length ? messagesForSelectedClient.map((message) => {
                          const isManagerMessage = message.senderRole === "manager" || message.senderRole === "accountant";
                          const canManageMessage = isManagerMessage && message.senderId === authUser?.id;
                          const replyTarget = messages.find((candidate) => candidate.id === message.replyToMessageId);
                          const timestampFormat = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en", { dateStyle: "medium", timeStyle: "short" });
                          const messageReadAt = isManagerMessage ? message.clientReadAt : message.managerReadAt;
                          return (
                            <article className={`message-row group${isManagerMessage ? " sent" : " received"}${message.pinnedAt ? " pinned" : ""}`} key={message.id}>
                              <div className={`message-bubble-wrap${isManagerMessage ? " sent" : ""}${openMessageActionsId === message.id ? " menu-open" : ""}`} data-message-action-container={message.id}>
                                <div className={`message-bubble${isManagerMessage ? " sent" : " received"}`}>
                                  {message.pinnedAt && <span className="message-pinned-label"><Icon name="pin" size={12} />{t("Pinned")}</span>}
                                  {message.replyToMessageId && (
                                    <div className="message-reply-quote">
                                      <strong>{t("Reply")}</strong>
                                      <span>{replyTarget?.body ?? t("Original message unavailable")}</span>
                                    </div>
                                  )}
                                  {message.forwardedFromMessageId && <span className="message-forwarded-label"><Icon name="forward" size={12} />{t("Forwarded message")}</span>}
                                  {editingMessageId === message.id ? (
                                    <div className="message-edit-form">
                                      <textarea
                                        aria-label={t("Edit message")}
                                        autoFocus
                                        maxLength={4000}
                                        onChange={(event) => setEditMessageDraft(event.target.value)}
                                        value={editMessageDraft}
                                      />
                                      <div className="message-edit-actions">
                                        <button
                                          disabled={savingMessageEdit || !editMessageDraft.trim()}
                                          onClick={() => void saveMessageEdit(message)}
                                          type="button"
                                        >
                                          {savingMessageEdit ? t("Saving…") : t("Save")}
                                        </button>
                                        <button
                                          disabled={savingMessageEdit}
                                          onClick={() => {
                                            setEditingMessageId(null);
                                            setEditMessageDraft("");
                                          }}
                                          type="button"
                                        >
                                          {t("Cancel")}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p>{message.body}</p>
                                  )}
                                  {editingMessageId !== message.id && (
                                    <button
                                      aria-expanded={openMessageActionsId === message.id}
                                      aria-haspopup="menu"
                                      aria-label={t("Message actions")}
                                      className="message-actions-trigger"
                                      onClick={() => {
                                        setConfirmingDeleteMessageId(null);
                                        setMessageInfoId(null);
                                        setForwardingMessageId(null);
                                        setOpenMessageActionsId((current) => current === message.id ? null : message.id);
                                      }}
                                      type="button"
                                    >
                                      <Icon name="chevronDown" size={16} />
                                    </button>
                                  )}
                                  <div className="message-bubble-footer">
                                    <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en", { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
                                    {isManagerMessage && <span aria-label={message.clientReadAt ? t("Read by client") : t("Not read yet")} className={`message-read-receipt${message.clientReadAt ? " read" : ""}`}>✓✓</span>}
                                  </div>
                                </div>
                                {openMessageActionsId === message.id && editingMessageId !== message.id && (
                                  <div aria-label={t("Message actions")} className="message-actions-menu" role="menu">
                                    <button onClick={() => setMessageInfoId((current) => current === message.id ? null : message.id)} role="menuitem" type="button">
                                      <Icon name="info" size={15} />{t("Message info")}
                                    </button>
                                    {messageInfoId === message.id && (
                                      <div className="message-info-details">
                                        <span>{t("Sent at")}<time dateTime={message.createdAt}>{timestampFormat.format(new Date(message.createdAt))}</time></span>
                                        <span>{t(isManagerMessage ? "Read by client" : "Read by you")}
                                          <time dateTime={messageReadAt ?? undefined}>{messageReadAt ? timestampFormat.format(new Date(messageReadAt)) : t("Not read yet")}</time>
                                        </span>
                                      </div>
                                    )}
                                    {interactiveMessageSchemaAvailable && (
                                      <button
                                        onClick={() => {
                                          setReplyingToMessageId(message.id);
                                          setOpenMessageActionsId(null);
                                          setMessageInfoId(null);
                                        }}
                                        role="menuitem"
                                        type="button"
                                      >
                                        <Icon name="reply" size={15} />{t("Reply")}
                                      </button>
                                    )}
                                    <button onClick={() => void copyMessage(message)} role="menuitem" type="button">
                                      <Icon name="copy" size={15} />{t("Copy")}
                                    </button>
                                    {interactiveMessageSchemaAvailable && (
                                      <button
                                        onClick={() => {
                                          setMessageInfoId(null);
                                          setForwardingMessageId((current) => current === message.id ? null : message.id);
                                        }}
                                        role="menuitem"
                                        type="button"
                                      >
                                        <Icon name="forward" size={15} />{t("Forward")}
                                      </button>
                                    )}
                                    {interactiveMessageSchemaAvailable && forwardingMessageId === message.id && (
                                      <div className="message-forward-picker">
                                        <strong>{t("Forward to")}</strong>
                                        {clients.filter((client): client is Client & { id: string } => client.id !== null).map((client) => (
                                          <button
                                            disabled={forwardingToClientId !== null}
                                            key={client.id}
                                            onClick={() => void forwardMessageToClient(message, client)}
                                            role="menuitem"
                                            type="button"
                                          >
                                            <span className={`messages-avatar avatar-${client.color}`}>{profileInitials(client.name)}</span>
                                            <span>{forwardingToClientId === client.id ? t("Please wait…") : client.name}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {interactiveMessageSchemaAvailable && (
                                      <button disabled={pinningMessageId === message.id} onClick={() => void toggleMessagePin(message)} role="menuitem" type="button">
                                        <Icon name="pin" size={15} />{t(message.pinnedAt ? "Unpin" : "Pin")}
                                      </button>
                                    )}
                                    {canManageMessage && (
                                      <button className="message-action-edit" onClick={() => editMessage(message)} role="menuitem" type="button">
                                        <Icon name="pencil" size={15} />{t("Edit")}
                                      </button>
                                    )}
                                    {canManageMessage && (
                                      confirmingDeleteMessageId === message.id ? (
                                        <div className="message-delete-confirm">
                                          <span>{t("Confirm delete?")}</span>
                                          <button
                                            className="message-action-delete"
                                            disabled={deletingMessageId === message.id}
                                            onClick={() => void deleteMessage(message)}
                                            role="menuitem"
                                            type="button"
                                          >
                                            <Icon name="trash" size={14} />{deletingMessageId === message.id ? t("Deleting…") : t("Delete")}
                                          </button>
                                          <button
                                            disabled={deletingMessageId === message.id}
                                            onClick={() => setConfirmingDeleteMessageId(null)}
                                            role="menuitem"
                                            type="button"
                                          >
                                            {t("Cancel")}
                                          </button>
                                        </div>
                                      ) : (
                                        <button className="message-action-delete" onClick={() => setConfirmingDeleteMessageId(message.id)} role="menuitem" type="button">
                                          <Icon name="trash" size={15} />{t("Delete")}
                                        </button>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            </article>
                          );
                        }) : (
                          <div className="messages-chat-empty">
                            <span className="messages-empty-icon"><Icon name="message" size={23} /></span>
                            <strong>{t("No messages yet. Send the first message.")}</strong>
                          </div>
                        )}
                      </div>
                      {replyingToMessage && (
                        <div className="message-reply-preview">
                          <span><strong>{t("Replying to")}</strong><span>{replyingToMessage.body}</span></span>
                          <button aria-label={t("Close")} onClick={() => setReplyingToMessageId(null)} type="button"><Icon name="close" size={15} /></button>
                        </div>
                      )}
                      <form className="messages-composer" onSubmit={sendMessage}>
                        <textarea
                          aria-label={t("Write a message...")}
                          disabled={clientsLoading || !selectedMessageClient?.id}
                          maxLength={4000}
                          onChange={(event) => {
                            setMessageDraft(event.target.value);
                            setMessagesError("");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          placeholder={t("Write a message...")}
                          rows={1}
                          value={messageDraft}
                        />
                        <button disabled={clientsLoading || !selectedMessageClient?.id || sendingMessage || !messageDraft.trim()} type="submit">
                          {sendingMessage ? t("Please wait…") : t("Send")} <Icon name="chevron" size={15} />
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="messages-no-selection">
                      <span className="messages-empty-icon"><Icon name="message" size={23} /></span>
                      <strong>{t("Select a conversation")}</strong>
                    </div>
                  )}
                </section>
              </section>
              {messagesToast && <div className="messages-toast" role="status">{messagesToast}</div>}
            </>
          )}

          {view === "Documents" && (
            <>
              <div className="page-title-row documents-title-row">
                <div>
                  <div className="date-eyebrow">{t("YOUR WORKSPACE")}</div>
                  <h1>{t("Documents")}</h1>
                  <p className="page-subtitle">{t("Browse and manage files shared by your clients.")}</p>
                </div>
              </div>
              {(documentsError || documentNotice) && (
                <p className={`document-notice${documentsError ? " error" : ""}`} role={documentsError ? "alert" : "status"}>
                  {documentsError || documentNotice}
                </p>
              )}
              <section className="content-card documents-library">
                <div className="documents-toolbar">
                  <label className="documents-search">
                    <Icon name="search" size={17} />
                    <input
                      aria-label={t("Search")}
                      onChange={(event) => setDocumentSearch(event.target.value)}
                      placeholder={t("Search documents...")}
                      type="search"
                      value={documentSearch}
                    />
                  </label>
                  <div aria-label={t("Filter documents by client")} className="document-client-filters">
                    <button
                      aria-pressed={documentClientId === null}
                      className={`document-client-filter${documentClientId === null ? " selected" : ""}`}
                      onClick={() => setDocumentClientId(null)}
                      type="button"
                    >
                      <span className="document-client-avatar all-clients-avatar"><Icon name="clients" size={15} /></span>
                      {t("All Clients")}
                    </button>
                    {clients.filter((client): client is Client & { id: string } => client.id !== null).map((client) => (
                      <button
                        aria-pressed={documentClientId === client.id}
                        className={`document-client-filter${documentClientId === client.id ? " selected" : ""}`}
                        key={client.id}
                        onClick={() => setDocumentClientId(client.id)}
                        type="button"
                      >
                        <span className={`document-client-avatar avatar-${client.color}`}>{profileInitials(client.name)}</span>
                        {client.name}
                        <span className="document-client-count">{documentCountsByClient.get(client.id) ?? 0}</span>
                      </button>
                    ))}
                  </div>
                  <div aria-label={t("Filter documents by category")} className="document-category-filters">
                    {documentCategoryOptions.map((option) => (
                      <button
                        aria-pressed={documentCategory === option.value}
                        className={`document-category-filter${documentCategory === option.value ? " selected" : ""}`}
                        key={option.value}
                        onClick={() => setDocumentCategory(option.value)}
                        type="button"
                      >
                        {t(option.label)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="documents-grid">
                  {filteredDocuments.map((document) => {
                    const client = clients.find((item) => item.id === document.clientId);
                    if (!client) return null;
                    const fileType = documentFileType(document.fileName, document.mimeType);
                    return (
                      <article
                        className={`document-card${selectedDocumentId === document.id ? " selected" : ""}`}
                        key={document.id}
                      >
                        <div className={`document-preview document-preview-${fileType.toLowerCase()}`}>
                          <span className="document-preview-icon"><Icon name="fileStack" size={35} /></span>
                          <span className="document-type-badge">{fileType}</span>
                        </div>
                        <div className="document-card-copy">
                          <span className="document-category-label">{t(documentCategoryLabels[document.category])}</span>
                          <h2 title={document.fileName}>{document.fileName}</h2>
                          <span className="document-client-name">{client.name} · {client.company}</span>
                          <div className="document-card-meta">
                            <time dateTime={document.createdAt}>{new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : locale === "ar" ? "ar-DZ" : "en", { dateStyle: "medium" }).format(new Date(document.createdAt))}</time>
                            <span>{formatFileSize(document.sizeBytes)}</span>
                          </div>
                          <button
                            className="document-share-button"
                            onClick={() => void shareDocument(document)}
                            type="button"
                          >
                            <Icon name="share" size={15} /> {t("Share")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!documentsLoading && !documentsError && filteredDocuments.length === 0 && (
                    <div className="documents-empty">
                      <span className="documents-empty-icon"><Icon name="fileStack" size={26} /></span>
                      <strong>{t("No documents found")}</strong>
                      <span>{t("Documents uploaded by your clients will appear here.")}</span>
                    </div>
                  )}
                  {documentsLoading && <p className="notification-status">{t("Loading notifications…")}</p>}
                  {documentsError && <p className="notification-error" role="alert">{documentsError}</p>}
                </div>
              </section>
            </>
          )}

          {view === "Clients" && (
            <>
              <div className="page-title-row">
                <div>
                  <div className="date-eyebrow">{t("YOUR WORKSPACE")}</div>
                  <h1>{t("Clients")}</h1>
                  <p className="page-subtitle">{t("Manage your client relationships and their documents.")}</p>
                </div>
              </div>

              <section className="content-card directory-card">
                <div className="card-heading" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h2>{selectedClient?.name ?? t("Your clients")}</h2>
                      <button
                        aria-label={t("Edit")}
                        aria-pressed={clientEditMode}
                        onClick={() => setClientEditMode((current) => !current)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: 0, padding: 0, cursor: "pointer", color: clientEditMode ? "#0f766e" : "inherit", fontSize: 13, fontWeight: 600 }}
                        title={t("Edit")}
                        type="button"
                      >
                        <Icon name="pencil" size={15} />
                        <span>{t("Edit")}</span>
                      </button>
                    </div>
                    <p>{filteredClients.length} {t("client workspaces")}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {selectedClientId && (
                      <button className="text-button" onClick={() => setSelectedClientId(null)} type="button">
                        {t("View all")} <Icon name="chevron" size={15} />
                      </button>
                    )}
                    <button
                      className="primary-button"
                      onClick={() => { setEditingClient(null); setFormError(""); setShowRequestForm(true); }}
                      type="button"
                    >
                      <Icon name="plus" size={17} /> {t("New request")}
                    </button>
                  </div>
                </div>

                <p className="client-notification-help">{t("Messages and push alerts are available in the website and client app.")}</p>

                {/* Search bar + separate Filters button.
                    paddingInline keeps the row lined up with the heading/help text above
                    instead of touching the card's left edge. */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, paddingInline: 24 }}>
                  <label
                    className="documents-search"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flex: "0 1 300px",
                      minWidth: 0,
                      minHeight: 0,
                      height: 42,
                      margin: 0,
                      background: "rgba(34, 139, 94, 0.14)",
                      border: "1px solid rgba(34, 139, 94, 0.45)",
                      borderRadius: 10,
                      padding: "0 14px",
                      fontSize: 14,
                    }}
                  >
                    <Icon name="search" size={16} />
                    <input
                      aria-label={t("Search")}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("Search clients...")}
                      style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", fontSize: 14, padding: 0 }}
                      type="search"
                      value={search}
                    />
                  </label>

                  <div style={{ position: "relative" }}>
                    <button
                      aria-expanded={showClientFilters}
                      onClick={() => setShowClientFilters((open) => !open)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: "0 16px", cursor: "pointer", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}
                      type="button"
                    >
                      <Icon name="filter" size={16} />
                      <span>{t("Filters")}{clientFilter !== "all" ? " · 1" : ""}</span>
                    </button>

                    {showClientFilters && (
                      <div
                        role="menu"
                        style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 20, minWidth: 240, background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", padding: 6 }}
                      >
                        {["all", ...templates.map((template) => template.title), "Custom document request"].map((option) => (
                          <button
                            aria-checked={clientFilter === option}
                            key={option}
                            onClick={() => { setClientFilter(option); setShowClientFilters(false); }}
                            role="menuitemradio"
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", background: clientFilter === option ? "rgba(34, 139, 94, 0.12)" : "transparent", border: 0, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}
                            type="button"
                          >
                            <span>{option === "all" ? t("All") : t(option)}</span>
                            {clientFilter === option && <Icon name="check" size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {clientNotice && <p className="client-notice" role="status">{clientNotice}</p>}
                {documentsError && <p className="notification-error client-page-error" role="alert">{documentsError}</p>}

                <div className="client-directory">
                  {filteredClients.map((client) => (
                    <article
                      className="directory-row"
                      key={client.id ?? client.email}
                      style={{ display: "flex", alignItems: "center", gap: 16 }}
                    >
                      <div className="directory-copy" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                          <div className={`client-avatar avatar-${client.color}`}>
                            {client.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}
                          </div>
                          <h3>{client.name}</h3>
                          {clientEditMode && (
                            <button
                              aria-label={`${t("Edit client details")} ${client.name}`}
                              className="edit-client-button"
                              disabled={!client.id || savingClient}
                              onClick={() => editClientDetails(client)}
                              style={{ width: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px" }}
                              title={t("Edit client details")}
                              type="button"
                            >
                              <Icon name="pencil" size={14} />
                              <span>{t("Edit")}</span>
                            </button>
                          )}
                        </div>
                        <span className="directory-company">{client.company}</span>
                        <span>{client.email}</span>
                        <span>{client.phone}</span>
                        <span className="directory-document-set">{t(client.documentSet)}</span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button
                          aria-label={`${t("Uploads")} ${client.name} ${client.company}`}
                          className="uploads-button"
                          disabled={!client.id}
                          onClick={() => {
                            if (!client.id) return;
                            setView("Documents");
                            setDocumentClientId(client.id);
                            setDocumentSearch("");
                            setDocumentCategory("all");
                            setSelectedDocumentId(null);
                          }}
                          title={t("View client uploads")}
                          type="button"
                        >
                          <Icon name="fileStack" size={16} />
                          <span>{t("Uploads")}</span>
                          <span className="uploads-count">{client.id ? documentCountsByClient.get(client.id) ?? 0 : 0}</span>
                        </button>
                        <button
                          aria-label={`${t("Messages")} ${client.name} ${client.company}`}
                          className="client-messages-button"
                          disabled={!client.id}
                          onClick={() => { if (client.id) openConversation(client.id); }}
                          type="button"
                        >
                          <Icon name="message" size={15} />
                          <span>{t("Messages")}</span>
                        </button>
                        <button
                          aria-label={`${t("Nudge")} ${client.name} ${client.company}`}
                          aria-pressed={nudgedClients.has(client.email)}
                          className={`nudge-button${nudgedClients.has(client.email) ? " nudged" : ""}`}
                          disabled={sendingNudgeTo !== null}
                          onClick={() => void sendClientNudge(client)}
                          title={t("Accountant reminder")}
                          type="button"
                        >
                          <BellIcon />
                          <span>{sendingNudgeTo === client.email ? t("Please wait…") : t(nudgedClients.has(client.email) ? "Nudge queued" : "Nudge")}</span>
                        </button>
                      </div>

                      <button
                        aria-label={`${t("Delete")} ${client.name}`}
                        className="delete-client-button"
                        disabled={!client.id || deletingClient}
                        onClick={() => {
                          setDocumentsError("");
                          setClientToDelete(client);
                        }}
                        title={t("Delete client")}
                        type="button"
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </article>
                  ))}

                  {filteredClients.length === 0 && (
                    <div className="empty-state">
                      {search.trim()
                        ? `${t("No clients match")} “${search}”.`
                        : clientFilter !== "all"
                          ? `${t("No clients match")} “${t(clientFilter)}”.`
                          : t("No clients yet. Add your first client with New request.")}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {view === "Templates" && (
            <>
              <div className="page-title-row"><div><div className="date-eyebrow">{t("SAVE TIME ON REPEAT WORK")}</div><h1>{t("Request templates")}</h1><p className="page-subtitle">{t("Start with a template and tailor document requests to each client.")}</p></div><button className="primary-button" onClick={() => { setEditingClient(null); setNewService(""); setFormError(""); setShowRequestForm(true); }} type="button"><Icon name="plus" size={17} /> {t("New request")}</button></div>
              <div className="template-grid">{templates.map((template) => <article className="content-card template-card" key={template.title}><span className={`stat-icon ${template.color}`}><Icon name="templates" /></span><h2>{t(template.title)}</h2><p>{t(template.description)}</p><div className="template-footer"><span>{template.count.split(" ")[0]} {t("documents")}</span><button className="text-button" onClick={() => { setEditingClient(null); setNewService(template.title); setFormError(""); setShowRequestForm(true); }} type="button">{t("Use template")} <Icon name="chevron" size={14} /></button></div></article>)}</div>
            </>
          )}

          {view === "Settings" && (
            <>
              <div className="page-title-row"><div><div className="date-eyebrow">{t("WORKSPACE PREFERENCES")}</div><h1>{t("Settings")}</h1><p className="page-subtitle">{t("Manage your CountaDocs workspace and profile.")}</p></div></div>
              <section className="content-card settings-card"><div className="card-heading"><div><h2>{t("Workspace profile")}</h2><p>{t("Your accounting practice details.")}</p></div></div><div className="settings-fields"><label>{t("Workspace name")}<input onChange={(event) => { setWorkspaceName(event.target.value); setSettingsNotice(""); }} placeholder={t("Enter your workspace name")} value={workspaceName} /></label><label>{t("Owner name")}<input readOnly value={profileName} /></label><label>{profileContactLabel}<input readOnly type={profileContactType} value={profileContact} /></label><label>{t("Recovery phone number")}<input autoComplete="tel" onChange={(event) => { setRecoveryPhone(event.target.value); setSettingsNotice(""); }} placeholder={t("e.g. +213 555 01 23 45")} type="tel" value={recoveryPhone} /><span className="settings-help">{t("Recovery information is demo-only and isn’t connected to account recovery yet.")}</span></label>{settingsNotice && <p className="settings-notice" role="status">{settingsNotice}</p>}<div className="settings-actions"><button className="primary-button" onClick={saveWorkspaceName} type="button">{t("Save changes")}</button><button className="cancel-button" disabled={authBusy} onClick={signOut} type="button">{t("Sign out")}</button></div></div></section>

              {/* Workspace Invite Code + QR */}
              <section className="content-card settings-card" style={{ marginTop: "20px" }}>
                <div className="card-heading">
                  <div>
                    <h2>{t("Client Access Code")}</h2>
                    <p>{t("Share this code with your clients so they can connect via the CountaDocs app.")}</p>
                  </div>
                </div>
                <div style={{ padding: "20px", textAlign: "center" }}>
                  {workspaceCode ? (
                    <>
                      {/* QR Code via Google Charts API */}
                      <div style={{ marginBottom: "16px" }}>
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(workspaceCode)}&bgcolor=ffffff&color=163826`}
                          alt={`QR code for ${workspaceCode}`}
                          width={200}
                          height={200}
                          style={{ borderRadius: "12px", border: "2px solid #E5E7EB" }}
                        />
                      </div>
                      {/* Text code */}
                      <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "12px",
                        background: "#F2F8F4",
                        border: "2px dashed #1E6543",
                        borderRadius: "10px",
                        padding: "10px 20px",
                      }}>
                        <span style={{ fontFamily: "monospace", fontSize: "20px", fontWeight: 700, color: "#163826", letterSpacing: "2px" }}>
                          {workspaceCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyWorkspaceCode()}
                          style={{
                            background: copiedCode ? "#15803D" : "#1E6543",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            padding: "6px 14px",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: 600,
                            transition: "background 0.2s ease",
                          }}
                        >
                          {copiedCode ? `✓ ${t("Copied!")}` : t("Copy")}
                        </button>
                      </div>
                      <div style={{ minHeight: "20px", marginTop: "6px" }}>
                        {copiedCode && (
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#15803D" }}>
                            ✓ {t("Copied successfully!")}
                          </span>
                        )}
                      </div>

                    </>
                  ) : (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={workspaceCodeLoading}
                      onClick={() => void fetchWorkspaceCode()}
                      style={{ margin: "20px auto" }}
                    >
                      {workspaceCodeLoading ? t("Generating...") : t("Generate Access Code")}
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
          <footer className="page-footer"><span>© 2026 CountaDocs</span><span>{t("Simple, secure client document collection.")}</span><button onClick={() => setView("Settings")} type="button">{t("Help & support")}</button></footer>
        </div>
      </main>

      {showConnectClientsModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowConnectClientsModal(false);
          }}
        >
          <section
            aria-labelledby="connect-clients-title"
            aria-modal="true"
            role="dialog"
            style={{
              background: "#FFFFFF",
              borderRadius: "16px",
              padding: "24px 28px",
              maxWidth: "460px",
              width: "92%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
              textAlign: "center",
              position: "relative",
            }}
          >
            {/* Header: Title + Subtitle + Close button without crowded grid */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px", gap: "16px" }}>
              <div style={{ textAlign: "left", flex: 1 }}>
                <h2 id="connect-clients-title" style={{ margin: "0 0 6px", fontSize: "19px", fontWeight: 700, color: "#163826", whiteSpace: "nowrap" }}>
                  {t("Connect Clients")}
                </h2>
                <p style={{ margin: 0, fontSize: "12px", color: "#6B7280", lineHeight: 1.5 }}>
                  {t("Share this QR code or access code with your clients so they can link to your workspace.")}
                </p>
              </div>
              <button
                aria-label={t("Close dialog")}
                className="icon-button"
                onClick={() => setShowConnectClientsModal(false)}
                type="button"
                style={{ flexShrink: 0, color: "#6B7280" }}
              >
                <Icon name="close" />
              </button>
            </div>

            <div style={{ padding: "4px 0" }}>
              {workspaceCode ? (
                <>
                  <div style={{ marginBottom: "14px", display: "flex", justifyContent: "center" }}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=${encodeURIComponent(workspaceCode)}&bgcolor=ffffff&color=163826`}
                      alt={`QR code for ${workspaceCode}`}
                      width={170}
                      height={170}
                      style={{ borderRadius: "10px", border: "1.5px solid #E5E7EB", padding: "6px", background: "#fff" }}
                    />
                  </div>

                  {/* Code box */}
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "12px",
                    background: "#F2F8F4",
                    border: "1.5px dashed #1E6543",
                    borderRadius: "8px",
                    padding: "8px 16px",
                  }}>
                    <span style={{ fontFamily: "monospace", fontSize: "19px", fontWeight: 700, color: "#163826", letterSpacing: "2px" }}>
                      {workspaceCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyWorkspaceCode()}
                      style={{
                        background: copiedCode ? "#15803D" : "#1E6543",
                        color: "#fff",
                        border: "none",
                        borderRadius: "5px",
                        padding: "5px 12px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        transition: "background 0.2s ease",
                      }}
                    >
                      {copiedCode ? `✓ ${t("Copied!")}` : t("Copy")}
                    </button>
                  </div>

                  {/* Small "Copied successfully!" text UNDER the code box */}
                  <div style={{ minHeight: "22px", marginTop: "6px" }}>
                    {copiedCode && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#15803D",
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {t("Copied successfully!")}
                      </span>
                    )}
                  </div>


                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={workspaceCodeLoading}
                  onClick={() => void fetchWorkspaceCode()}
                  style={{ margin: "14px auto" }}
                >
                  {workspaceCodeLoading ? t("Generating...") : t("Generate Access Code")}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {showRequestForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClientForm(); }}>
          <section aria-labelledby="request-modal-title" aria-modal="true" className="request-modal" role="dialog">
            <div className="modal-heading"><div><span className="modal-icon"><Icon name={editingClient ? "pencil" : "file"} size={19} /></span><h2 id="request-modal-title">{editingClient ? t("Edit client details") : t("New client and request")}</h2><p>{editingClient ? t("Update the client’s contact and document information.") : t("Choose a client and the documents you need from them.")}</p></div><button aria-label={t("Close dialog")} className="icon-button" onClick={closeClientForm} type="button"><Icon name="close" /></button></div>
            <form onSubmit={createRequest}>
              <label className="form-label">{t("Client full name")}<input autoFocus autoComplete="name" onChange={(event) => setNewClient(event.target.value)} placeholder={t("e.g. Amine Benali")} required value={newClient} /></label>
              <label className="form-label">{t("Company name")}<input autoComplete="organization" onChange={(event) => setNewCompany(event.target.value)} placeholder={t("e.g. ACME Accounting")} required value={newCompany} /></label>
              <label className="form-label">{t("Email address")}<input autoComplete="email" onChange={(event) => setNewEmail(event.target.value)} placeholder={t("name@company.com")} required type="email" value={newEmail} /></label>
              <div className="form-label">
                <label htmlFor="client-phone">{t("Phone number")}</label>
                <span className="phone-field">
                  <span className="country-picker" ref={countryPickerRef}>
                    <button
                      aria-expanded={countryPickerOpen}
                      aria-haspopup="listbox"
                      aria-label={`${t("Country code")}: ${selectedPhoneCountry.name} +${selectedPhoneCountry.callingCode}`}
                      className="country-picker-button"
                      onClick={() => {
                        setCountrySearch("");
                        setCountryPickerOpen((open) => !open);
                      }}
                      type="button"
                    >
                      <span>{flagForCountry(selectedPhoneCountry.country)} +{selectedPhoneCountry.callingCode}</span>
                      <span aria-hidden="true" className="country-picker-chevron">⌄</span>
                    </button>
                    {countryPickerOpen && (
                      <span className="country-picker-menu">
                        <input
                          aria-label={t("Search countries")}
                          autoComplete="off"
                          autoFocus
                          className="country-picker-search"
                          onChange={(event) => setCountrySearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setCountryPickerOpen(false);
                          }}
                          placeholder={t("Search countries")}
                          type="search"
                          value={countrySearch}
                        />
                        <span aria-label={t("Country code")} className="country-picker-options" role="listbox">
                          {filteredPhoneCountries.length > 0 ? filteredPhoneCountries.map(({ country, callingCode, name }) => (
                            <button
                              aria-selected={country === phoneCountry}
                              className="country-picker-option"
                              key={country}
                              onClick={() => {
                                setPhoneCountry(country);
                                setCountryPickerOpen(false);
                                setCountrySearch("");
                              }}
                              role="option"
                              type="button"
                            >
                              <span>{flagForCountry(country)} {name}</span>
                              <span>+{callingCode}</span>
                            </button>
                          )) : <span className="country-picker-empty">{t("No countries found")}</span>}
                        </span>
                      </span>
                    )}
                  </span>
                  <input
                    id="client-phone"
                    autoComplete="tel-national"
                    onChange={(event) => {
                      const recognized = recognizePhoneCountry(event.target.value, phoneCountry);
                      setPhoneCountry(recognized.country);
                      setNewPhone(recognized.phone);
                    }}
                    placeholder="555 01 23 45"
                    required
                    type="tel"
                    value={newPhone}
                  />
                </span>
                <span className="phone-help">{t("Choose a country code, or paste an international number to detect it automatically.")}</span>
              </div>
              <label className="form-label">{t("Document set")}<select onChange={(event) => setNewService(event.target.value)} required value={newService}><option disabled hidden value="">{t("Choose a document set...")}</option>{templates.map((template) => <option key={template.title} value={template.title}>{t(template.title)}</option>)}<option value="Custom document request">{t("Custom document request")}</option></select></label>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions"><button className="cancel-button" onClick={closeClientForm} type="button">{t("Cancel")}</button><button className="primary-button" disabled={savingClient} type="submit"><Icon name={editingClient ? "check" : "plus"} size={16} /> {savingClient ? t("Please wait…") : t(editingClient ? "Save client details" : "Register client & create request")}</button></div>
              <p className="demo-disclaimer">{t("Demo workspace · client records and requests stay in this page only.")}</p>
            </form>
          </section>
        </div>
      )}

      {clientToDelete && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingClient) setClientToDelete(null); }}>
          <section aria-labelledby="delete-client-title" aria-modal="true" className="request-modal delete-client-modal" role="alertdialog">
            <div className="modal-heading">
              <div>
                <span className="modal-icon delete-modal-icon"><Icon name="close" size={19} /></span>
                <h2 id="delete-client-title">{t("Delete client")}</h2>
                <p>{t("Are you sure you want to delete")} <strong>{clientToDelete.name}</strong>? {t("This will also permanently remove all their uploaded documents.")}</p>
              </div>
              <button aria-label={t("Close dialog")} className="icon-button" disabled={deletingClient} onClick={() => setClientToDelete(null)} type="button"><Icon name="close" /></button>
            </div>
            {documentsError && <p className="form-error" role="alert">{documentsError}</p>}
            <div className="modal-actions">
              <button className="cancel-button" disabled={deletingClient} onClick={() => setClientToDelete(null)} type="button">{t("Cancel")}</button>
              <button className="delete-confirm-button" disabled={deletingClient} onClick={() => void deleteClient(clientToDelete)} type="button">
                {deletingClient ? t("Please wait…") : t("Delete client")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}