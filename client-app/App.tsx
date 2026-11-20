import { StatusBar } from "expo-status-bar";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import PermissionScreen from "./components/PermissionScreen";
import { hasPushPermission, registerPushToken } from "./lib/notifications";

type SoundKey = "bell" | "soft_chime" | "double_bell";
type ClientAccount = { id: string; company_name: string; document_set: string };
type ClientMessage = {
  id: string;
  client_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  manager_read_at: string | null;
  client_read_at: string | null;
};
type ClientNotification = {
  id: string;
  client_id: string;
  title: string;
  body: string;
  created_at: string;
};
type ClientMembership = { client_id: string; clients: ClientAccount[] | null };
type SupabaseClientInstance = NonNullable<typeof supabase>;

const documentMimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

function documentCategory(fileName: string) {
  const name = fileName.toLowerCase();
  if (/bank|statement/.test(name)) return "bank_statements";
  if (/invoice|facture/.test(name)) return "invoices";
  if (/tax|fiscal|impot|impôt/.test(name)) return "tax_forms";
  if (/payroll|salary|salaire|paie/.test(name)) return "payroll";
  if (/receipt|reçu|recu|expense|dépense|depense/.test(name)) return "receipts";
  return "other";
}

function storageFileName(fileName: string) {
  return fileName.normalize("NFKC").replace(/[^\w.-]+/g, "_").replace(/^\.|\.+$/g, "").slice(-120) || "document";
}

function uniqueStoragePath(clientId: string, fileName: string) {
  return `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${fileName}`;
}

const sounds: { key: SoundKey; label: string; file: string }[] = [
  { key: "bell", label: "Classic bell · Default", file: "bell.wav" },
  { key: "soft_chime", label: "Soft chime", file: "soft_chime.wav" },
  { key: "double_bell", label: "Double bell", file: "double_bell.wav" },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function createNotificationChannels() {
  if (Platform.OS !== "android") return;
  for (const sound of sounds) {
    await Notifications.setNotificationChannelAsync(sound.key, {
      name: sound.label,
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      sound: sound.file,
    });
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(supabase !== null);
  const [permissionCheckedUserId, setPermissionCheckedUserId] = useState<string | null>(null);
  const [showPermissionScreen, setShowPermissionScreen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [soundKey, setSoundKey] = useState<SoundKey>("bell");
  const [dataLoading, setDataLoading] = useState(true);
  const [soundSaving, setSoundSaving] = useState(false);
  const [uploadingClientId, setUploadingClientId] = useState<string | null>(null);
  const [selectedMessageClientId, setSelectedMessageClientId] = useState<string | null>(null);
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageSending, setMessageSending] = useState(false);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setPermissionCheckedUserId(null);
      setShowPermissionScreen(false);
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setNotice("");
      if (!session) {
        setSelectedMessageClientId(null);
        setClientMessages([]);
        setMessageLoading(false);
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setNotice(error.message);
      } else {
        setUser(data.session?.user ?? null);
      }
      setAuthLoading(false);
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Could not restore your session.");
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const client = supabase;
    const signedInUser = user;
    if (!client || !signedInUser) return;

    let disposed = false;
    let channel: ReturnType<SupabaseClientInstance["channel"]> | null = null;

    async function loadClientInbox(
      activeClient: SupabaseClientInstance,
      activeUser: User,
    ) {
      const { error: claimError } = await activeClient.rpc("claim_client_memberships");
      if (claimError) throw new Error(claimError.message);

      const { data: memberships, error: membershipError } = await activeClient
        .from("client_members")
        .select("client_id, clients(id, company_name, document_set)")
        .eq("user_id", activeUser.id);
      if (membershipError) throw new Error(membershipError.message);

      const linkedMemberships = (memberships ?? []) as ClientMembership[];
      const linkedClients = linkedMemberships
        .flatMap((membership) => membership.clients ?? []);
      const clientIds = linkedMemberships.map((membership) => membership.client_id);
      if (disposed) return;
      setClients(linkedClients);
      setSelectedMessageClientId((current) => current && linkedClients.some((item) => item.id === current)
        ? current
        : linkedClients[0]?.id ?? null);

      const { data: preference, error: preferenceError } = await activeClient
        .from("client_notification_preferences")
        .select("sound_key")
        .eq("user_id", activeUser.id)
        .maybeSingle();
      if (preferenceError) throw new Error(preferenceError.message);
      const preferredSound = sounds.find((sound) => sound.key === preference?.sound_key);
      if (preferredSound) setSoundKey(preferredSound.key);

      if (clientIds.length === 0) {
        setNotifications([]);
        return;
      }

      const { data: inboxItems, error: inboxError } = await activeClient
        .from("client_notifications")
        .select("id, client_id, title, body, created_at")
        .in("client_id", clientIds)
        .order("created_at", { ascending: false })
        .limit(30);
      if (inboxError) throw new Error(inboxError.message);
      if (!disposed) setNotifications((inboxItems ?? []) as ClientNotification[]);

      channel = activeClient
        .channel(`client-inbox-${activeUser.id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "client_notifications",
        }, (payload) => {
          const incoming = payload.new;
          if (
            typeof incoming.id === "string"
            && typeof incoming.client_id === "string"
            && clientIds.includes(incoming.client_id)
            && typeof incoming.title === "string"
            && typeof incoming.body === "string"
            && typeof incoming.created_at === "string"
          ) {
            const notification: ClientNotification = {
              id: incoming.id,
              client_id: incoming.client_id,
              title: incoming.title,
              body: incoming.body,
              created_at: incoming.created_at,
            };
            setNotifications((current) => [
              notification,
              ...current.filter((item) => item.id !== notification.id),
            ]);
          }
        })
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setNotice(error?.message ?? "Live inbox updates could not be started.");
          }
        });
    }

    void loadClientInbox(client, signedInUser).catch((error: unknown) => {
      if (!disposed) {
        setNotice(error instanceof Error ? error.message : "Could not load your client reminders.");
      }
    }).finally(() => {
      if (!disposed) setDataLoading(false);
    });

    return () => {
      disposed = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    const activeClient = supabase;
    const activeUser = user;
    const activeClientId = selectedMessageClientId;
    if (!activeClient || !activeUser || !activeClientId) return;
    const client = activeClient;
    const signedInUser = activeUser;
    const clientId = activeClientId;

    let disposed = false;
    let channel: ReturnType<SupabaseClientInstance["channel"]> | null = null;
    const messageColumns = "id, client_id, sender_id, body, created_at, manager_read_at, client_read_at";

    async function loadConversation() {
      setMessageLoading(true);
      const { error: readError } = await client.rpc("mark_client_messages_read", {
        p_client_id: clientId,
      });
      if (readError) throw new Error(readError.message);

      const { data, error } = await client
        .from("client_messages")
        .select(messageColumns)
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      if (disposed) return;
      setClientMessages((data ?? []) as ClientMessage[]);

      channel = client
        .channel(`client-messages-${clientId}-${signedInUser.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "client_messages",
          filter: `client_id=eq.${clientId}`,
        }, (payload) => {
          if (payload.eventType === "DELETE") {
            if (typeof payload.old.id === "string") {
              setClientMessages((current) => current.filter((message) => message.id !== payload.old.id));
            }
            return;
          }
          const incoming = payload.new;
          if (
            typeof incoming.id !== "string"
            || typeof incoming.client_id !== "string"
            || typeof incoming.sender_id !== "string"
            || typeof incoming.body !== "string"
            || typeof incoming.created_at !== "string"
            || (typeof incoming.manager_read_at !== "string" && incoming.manager_read_at !== null)
            || (typeof incoming.client_read_at !== "string" && incoming.client_read_at !== null)
          ) return;
          const message = incoming as ClientMessage;
          setClientMessages((current) => [
            ...current.filter((item) => item.id !== message.id),
            message,
          ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
          if (message.sender_id !== signedInUser.id) {
            void client.rpc("mark_client_messages_read", { p_client_id: clientId })
              .then(({ error: markError }) => {
                if (markError && !disposed) setNotice(`Could not mark messages as read. ${markError.message}`);
              });
          }
        })
        .subscribe((status, error) => {
          if (!disposed && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
            setNotice(error?.message ?? "Live messages could not be started.");
          }
        });
    }

    void loadConversation().catch((error: unknown) => {
      if (!disposed) setNotice(error instanceof Error ? `Could not load messages. ${error.message}` : "Could not load messages.");
    }).finally(() => {
      if (!disposed) setMessageLoading(false);
    });

    return () => {
      disposed = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [selectedMessageClientId, user]);

  useEffect(() => {
    let disposed = false;
    const activeUser = user;

    if (!activeUser) {
      return;
    }
    const signedInUser = activeUser;

    const supportsPush = Device.isDevice && (Platform.OS === "ios" || Platform.OS === "android");
    if (!supportsPush) return;

    async function checkPushSetup() {
      try {
        const [seen, permissionGranted] = await Promise.all([
          SecureStore.getItemAsync(`push-permission-screen-seen:${signedInUser.id}`),
          hasPushPermission(),
        ]);
        if (disposed) return;

        if (permissionGranted) {
          setShowPermissionScreen(false);
          setPermissionCheckedUserId(signedInUser.id);
          void registerPushToken(signedInUser.id).catch((error: unknown) => {
            if (!disposed) setNotice(error instanceof Error ? error.message : "Could not register this phone for push notifications.");
          });
        } else {
          setShowPermissionScreen(seen !== "true");
          setPermissionCheckedUserId(signedInUser.id);
        }
      } catch (error: unknown) {
        if (disposed) return;
        setNotice(error instanceof Error ? error.message : "Could not check notification permissions.");
        setShowPermissionScreen(false);
        setPermissionCheckedUserId(signedInUser.id);
      }
    }

    void checkPushSetup();
    return () => {
      disposed = true;
    };
  }, [user]);

  async function completeSignIn(session: Session) {
    setPermissionCheckedUserId(null);
    setShowPermissionScreen(false);
    setUser(session.user);
    setNotice("");
  }

  async function submitAuth() {
    if (!supabase) {
      setNotice("Add the Supabase URL and publishable key to client-app/.env.local, then restart Expo.");
      return;
    }
    setNotice("");
    setRegistering(true);
    try {
      if (signingUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) {
          setNotice(error.message);
        } else if (data.session) {
          await completeSignIn(data.session);
        } else {
          setNotice("Account created. Confirm your email, then return here and sign in with the same email.");
          setSigningUp(false);
          setPassword("");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setNotice(error.message);
        } else {
          await completeSignIn(data.session);
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not complete sign-in.");
    } finally {
      setRegistering(false);
    }
  }

  async function updateSound(nextSound: SoundKey) {
    if (!supabase || !user) return;
    setSoundSaving(true);
    setNotice("");
    try {
      await createNotificationChannels();
      const { error } = await supabase
        .from("client_notification_preferences")
        .upsert({
          user_id: user.id,
          sound_key: nextSound,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (error) {
        setNotice(error.message);
        return;
      }
      setSoundKey(nextSound);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save your sound preference.");
    } finally {
      setSoundSaving(false);
    }
  }

  async function previewSound() {
    const selectedSound = sounds.find((sound) => sound.key === soundKey) ?? sounds[0];
    try {
      await createNotificationChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Sound preview",
          body: `This is your ${selectedSound.label.toLowerCase()} reminder sound.`,
          sound: selectedSound.file,
        },
        trigger: Platform.OS === "android" ? { channelId: selectedSound.key } : null,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not play the sound preview.");
    }
  }

  async function uploadClientDocument(clientId: string) {
    if (uploadingClientId) return;
    if (!supabase || !user) {
      setNotice("Sign in again before uploading a document.");
      return;
    }
    setNotice("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Object.values(documentMimeTypes),
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("The selected document could not be read.");
      if (asset.size === 0 || (asset.size !== undefined && asset.size > 20 * 1024 * 1024)) {
        throw new Error("Choose a document smaller than 20 MB.");
      }

      const extension = asset.name.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = asset.mimeType && asset.mimeType !== "application/octet-stream"
        ? asset.mimeType
        : documentMimeTypes[extension];
      if (!mimeType) throw new Error("Choose a PDF, spreadsheet, Word document, or image file.");

      setUploadingClientId(clientId);
      const fileResponse = await fetch(asset.uri);
      if (!fileResponse.ok) throw new Error(`Could not read the selected document (${fileResponse.status}).`);
      const fileBody = await fileResponse.arrayBuffer();
      if (fileBody.byteLength === 0 || fileBody.byteLength > 20 * 1024 * 1024) {
        throw new Error("Choose a document smaller than 20 MB.");
      }

      const fileName = storageFileName(asset.name);
      const storagePath = uniqueStoragePath(clientId, fileName);
      const { error: storageError } = await supabase.storage
        .from("client-documents")
        .upload(storagePath, fileBody, { contentType: mimeType, upsert: false });
      if (storageError) throw new Error(storageError.message);

      const { error: recordError } = await supabase
        .from("client_documents")
        .insert({
          client_id: clientId,
          uploaded_by: user.id,
          storage_path: storagePath,
          file_name: asset.name,
          mime_type: mimeType,
          size_bytes: fileBody.byteLength,
          category: documentCategory(asset.name),
        });
      if (recordError) {
        const { error: cleanupError } = await supabase.storage.from("client-documents").remove([storagePath]);
        throw new Error(cleanupError
          ? `${recordError.message} The uploaded file could not be removed: ${cleanupError.message}`
          : recordError.message);
      }
      setNotice(`${asset.name} uploaded successfully.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not upload this document.");
    } finally {
      setUploadingClientId(null);
    }
  }

  async function sendClientMessage() {
    const body = messageDraft.trim();
    const clientId = selectedMessageClientId;
    if (!supabase || !user || !clientId || !body || messageSending) return;
    if (body.length > 4000) {
      setNotice("Messages must be 4,000 characters or fewer.");
      return;
    }

    setMessageSending(true);
    setNotice("");
    try {
      const { data, error } = await supabase
        .from("client_messages")
        .insert({ client_id: clientId, sender_id: user.id, sender_role: "client", body })
        .select("id, client_id, sender_id, body, created_at, manager_read_at, client_read_at")
        .single();
      if (error) throw new Error(error.message);
      setClientMessages((current) => [
        ...current.filter((message) => message.id !== data.id),
        data as ClientMessage,
      ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
      setMessageDraft("");
    } catch (error) {
      setNotice(error instanceof Error ? `Could not send this message. ${error.message}` : "Could not send this message.");
    } finally {
      setMessageSending(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(error.message);
    else setNotice("");
  }

  const selectedMessageClient = clients.find((client) => client.id === selectedMessageClientId);

  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#0d716b" size="large" />
        <Text style={styles.muted}>Loading L Docs…</Text>
        <StatusBar style="dark" />
      </View>
    );
  }

  if (!user) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.page}>
        <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Text style={styles.brandLetter}>L</Text></View>
          <Text style={styles.brand}>L <Text style={styles.brandAccent}>Docs</Text></Text>
          <Text style={styles.heading}>{signingUp ? "Create your client account" : "Client sign in"}</Text>
          <Text style={styles.intro}>
            Use the same verified email address your accounting manager added to L Docs.
          </Text>
          {!supabase && <Text style={styles.notice}>Add the Supabase URL and publishable key to client-app/.env.local, then restart Expo.</Text>}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor="#8b9691"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete={signingUp ? "new-password" : "password"}
            onChangeText={setPassword}
            onSubmitEditing={() => void submitAuth()}
            placeholder="Password"
            placeholderTextColor="#8b9691"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={registering || !supabase || !email.trim() || !password}
            onPress={() => void submitAuth()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (registering || !supabase || !email.trim() || !password) && styles.disabled]}
          >
            {registering ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{signingUp ? "Create account" : "Sign in"}</Text>}
          </Pressable>
          <Pressable onPress={() => { setSigningUp(!signingUp); setNotice(""); }} style={styles.linkButton}>
            <Text style={styles.linkText}>{signingUp ? "Already have an account? Sign in" : "New client? Create an account"}</Text>
          </Pressable>
        </ScrollView>
        <StatusBar style="dark" />
      </KeyboardAvoidingView>
    );
  }

  const supportsPush = Device.isDevice && (Platform.OS === "ios" || Platform.OS === "android");
  if (supportsPush && permissionCheckedUserId !== user.id) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#0d716b" size="large" />
        <Text style={styles.muted}>Checking notification settings…</Text>
        <StatusBar style="dark" />
      </View>
    );
  }

  if (showPermissionScreen) {
    return (
      <>
        <PermissionScreen
          onDone={() => {
            setShowPermissionScreen(false);
            void SecureStore.setItemAsync(`push-permission-screen-seen:${user.id}`, "true")
              .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not save your notification choice."));
          }}
          onNotice={setNotice}
          userId={user.id}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <View style={styles.page}>
      <FlatList
        contentContainerStyle={styles.inboxContent}
        data={notifications}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{dataLoading ? "Loading your inbox…" : clients.length ? "You're all caught up" : "Waiting for your manager"}</Text>
            <Text style={styles.muted}>
              {clients.length
                ? "New document reminders will appear here."
                : "When your manager adds this verified email to a client account, reminders will show up here."}
            </Text>
          </View>
        )}
        ListHeaderComponent={(
          <View>
            <View style={styles.header}>
              <View>
                <Text style={styles.brand}>L <Text style={styles.brandAccent}>Docs</Text></Text>
                <Text style={styles.muted}>{user.email}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOutButton}>
                <Text style={styles.linkText}>Sign out</Text>
              </Pressable>
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.heading}>Your reminders</Text>
              <Text style={styles.intro}>Messages from your accounting manager.</Text>
            </View>
            {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
            {clients.length > 0 && (
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Your client workspaces</Text>
                {clients.map((client) => (
                  <View key={client.id} style={styles.clientItem}>
                    <Text style={styles.clientName}>{client.company_name}</Text>
                    <Text style={styles.muted}>{client.document_set}</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={uploadingClientId !== null}
                      onPress={() => void uploadClientDocument(client.id)}
                      style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed, uploadingClientId !== null && styles.disabled]}
                    >
                      {uploadingClientId === client.id
                        ? <ActivityIndicator color="#0d716b" size="small" />
                        : <Text style={styles.uploadButtonText}>Upload a document</Text>}
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Messages</Text>
              <Text style={styles.muted}>Chat with your accounting manager.</Text>
              {clients.length > 1 && (
                <ScrollView horizontal contentContainerStyle={styles.messageClientList} showsHorizontalScrollIndicator={false}>
                  {clients.map((client) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedMessageClientId === client.id }}
                      key={client.id}
                      onPress={() => {
                        setClientMessages([]);
                        setSelectedMessageClientId(client.id);
                      }}
                      style={[styles.messageClientButton, selectedMessageClientId === client.id && styles.messageClientButtonSelected]}
                    >
                      <Text style={[styles.messageClientText, selectedMessageClientId === client.id && styles.messageClientTextSelected]}>{client.company_name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              {selectedMessageClient ? (
                <>
                  <View accessibilityLiveRegion="polite" style={styles.messageHistory}>
                    {messageLoading ? (
                      <ActivityIndicator color="#0d716b" />
                    ) : clientMessages.length ? clientMessages.map((message) => (
                      <View key={message.id} style={[styles.messageBubble, message.sender_id === user.id ? styles.messageBubbleSent : styles.messageBubbleReceived]}>
                        <Text style={styles.messageBody}>{message.body}</Text>
                        <Text style={styles.messageTime}>{new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                      </View>
                    )) : (
                      <Text style={styles.messageEmpty}>No messages yet. Send the first message.</Text>
                    )}
                  </View>
                  <View style={styles.messageComposer}>
                    <TextInput
                      accessibilityLabel="Write a message"
                      editable={!messageSending}
                      maxLength={4000}
                      multiline
                      onChangeText={setMessageDraft}
                      onSubmitEditing={() => void sendClientMessage()}
                      placeholder="Write a message..."
                      style={styles.messageInput}
                      value={messageDraft}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={messageSending || !messageDraft.trim()}
                      onPress={() => void sendClientMessage()}
                      style={({ pressed }) => [styles.messageSendButton, pressed && styles.pressed, (messageSending || !messageDraft.trim()) && styles.disabled]}
                    >
                      {messageSending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.messageSendText}>Send</Text>}
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.messageEmpty}>Messages will appear when you’re linked to a client workspace.</Text>
              )}
            </View>
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Notification sound</Text>
              <Text style={styles.muted}>Choose the sound for future reminders.</Text>
              {sounds.map((sound) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: soundKey === sound.key, disabled: soundSaving }}
                  disabled={soundSaving}
                  key={sound.key}
                  onPress={() => void updateSound(sound.key)}
                  style={styles.soundOption}
                >
                  <View style={[styles.radio, soundKey === sound.key && styles.radioSelected]}>
                    {soundKey === sound.key && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.soundLabel}>{sound.label}</Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => void previewSound()} style={styles.previewButton}>
                <Text style={styles.previewText}>Preview selected sound</Text>
              </Pressable>
            </View>
            <Text style={styles.sectionHeading}>Recent reminders</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.notificationCard}>
            <View style={styles.notificationMark}><Text style={styles.notificationBell}>♢</Text></View>
            <View style={styles.notificationCopy}>
              <Text style={styles.clientName}>{item.title}</Text>
              <Text style={styles.notificationBody}>{item.body}</Text>
              <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={<Text style={styles.footer}>Signed in as {user.email}</Text>}
      />
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f7f9f8" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f7f9f8" },
  authContent: { flexGrow: 1, justifyContent: "center", padding: 26 },
  brandMark: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#0d716b" },
  brandLetter: { color: "#fff", fontSize: 24, fontWeight: "800" },
  brand: { marginTop: 12, color: "#18211f", fontSize: 23, fontWeight: "600" },
  brandAccent: { color: "#0d716b" },
  heading: { marginTop: 30, color: "#18211f", fontSize: 27, fontWeight: "700", letterSpacing: -0.7 },
  intro: { marginTop: 8, marginBottom: 22, color: "#77817f", fontSize: 14, lineHeight: 21 },
  input: { height: 50, marginBottom: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#e2e9e6", borderRadius: 9, color: "#18211f", backgroundColor: "#fff", fontSize: 15 },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 7, borderRadius: 9, backgroundColor: "#0d716b" },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.48 },
  linkButton: { alignItems: "center", paddingVertical: 18 },
  linkText: { color: "#0d716b", fontSize: 14, fontWeight: "600" },
  notice: { marginVertical: 12, padding: 12, borderWidth: 1, borderColor: "#f1dfad", borderRadius: 8, color: "#795d16", backgroundColor: "#fff9e9", fontSize: 13, lineHeight: 19 },
  inboxContent: { padding: 20, paddingTop: 55, paddingBottom: 34 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  signOutButton: { padding: 10 },
  titleBlock: { marginBottom: 20 },
  sectionHeading: { marginTop: 24, marginBottom: 11, color: "#18211f", fontSize: 18, fontWeight: "700" },
  panel: { marginBottom: 16, padding: 16, borderWidth: 1, borderColor: "#e8edeb", borderRadius: 12, backgroundColor: "#fff" },
  sectionTitle: { marginBottom: 7, color: "#26332e", fontSize: 15, fontWeight: "700" },
  clientItem: { paddingTop: 11, borderTopWidth: 1, borderTopColor: "#f0f3f2" },
  uploadButton: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: "#cfe5db", borderRadius: 7, backgroundColor: "#f3faf6" },
  uploadButtonText: { color: "#0d716b", fontSize: 13, fontWeight: "600" },
  messageClientList: { gap: 7, paddingVertical: 10 },
  messageClientButton: { maxWidth: 180, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: "#e1e9e5", borderRadius: 18, backgroundColor: "#fff" },
  messageClientButtonSelected: { borderColor: "#c8e3d1", backgroundColor: "#edf7f0" },
  messageClientText: { color: "#6d7973", fontSize: 11 },
  messageClientTextSelected: { color: "#276846", fontWeight: "600" },
  messageHistory: { minHeight: 140, maxHeight: 340, gap: 8, paddingVertical: 9 },
  messageBubble: { maxWidth: "82%", gap: 5, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: "#e6ece8", borderRadius: 10, backgroundColor: "#fff" },
  messageBubbleSent: { alignSelf: "flex-end", borderColor: "#d2e8d8", backgroundColor: "#edf7f0" },
  messageBubbleReceived: { alignSelf: "flex-start" },
  messageBody: { color: "#34423b", fontSize: 13, lineHeight: 19 },
  messageTime: { alignSelf: "flex-end", color: "#84918a", fontSize: 10 },
  messageEmpty: { paddingVertical: 20, color: "#84918a", fontSize: 12, textAlign: "center" },
  messageComposer: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 8 },
  messageInput: { minHeight: 42, maxHeight: 100, flex: 1, paddingVertical: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: "#e1e9e5", borderRadius: 7, color: "#25332c", backgroundColor: "#fbfcfb", fontSize: 13 },
  messageSendButton: { minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: 7, backgroundColor: "#0d716b" },
  messageSendText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  clientName: { color: "#293632", fontSize: 14, fontWeight: "600" },
  muted: { marginTop: 4, color: "#77817f", fontSize: 13, lineHeight: 19 },
  soundOption: { flexDirection: "row", alignItems: "center", minHeight: 45, gap: 11 },
  radio: { width: 20, height: 20, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#aab5b0", borderRadius: 10 },
  radioSelected: { borderColor: "#0d716b" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#0d716b" },
  soundLabel: { color: "#36423d", fontSize: 14 },
  previewButton: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 7, backgroundColor: "#e5f5f1" },
  previewText: { color: "#0d716b", fontSize: 13, fontWeight: "600" },
  emptyState: { alignItems: "center", paddingHorizontal: 14, paddingVertical: 34, borderWidth: 1, borderColor: "#e8edeb", borderRadius: 12, backgroundColor: "#fff" },
  emptyTitle: { color: "#293632", fontSize: 16, fontWeight: "600" },
  notificationCard: { flexDirection: "row", gap: 12, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: "#e8edeb", borderRadius: 11, backgroundColor: "#fff" },
  notificationMark: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#e5f5f1" },
  notificationBell: { color: "#0d716b", fontSize: 21, fontWeight: "700" },
  notificationCopy: { flex: 1 },
  notificationBody: { marginTop: 5, color: "#53615b", fontSize: 13, lineHeight: 19 },
  timestamp: { marginTop: 8, color: "#87918d", fontSize: 11 },
  footer: { paddingTop: 20, color: "#98a19e", textAlign: "center", fontSize: 11 },
});
