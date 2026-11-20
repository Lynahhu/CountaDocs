import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export async function hasPushPermission() {
  const permission = await Notifications.getPermissionsAsync();
  return permission.status === "granted";
}

export async function requestPushPermission() {
  if (!Device.isDevice) {
    throw new Error("Push alerts need a physical phone; sign-in and your inbox still work here.");
  }
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Push notifications can only be registered on an iPhone or Android phone.");
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("bell", {
      name: "Client reminders",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      sound: "bell.wav",
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  if (currentPermission.status === "granted") return true;

  const requestedPermission = await Notifications.requestPermissionsAsync();
  return requestedPermission.status === "granted";
}

export async function registerPushToken(userId: string) {
  if (!supabase) throw new Error("Push setup needs a configured Supabase project.");

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error("Push setup needs an Expo project ID. Follow the EAS setup steps in the project README.");
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase
    .from("client_push_tokens")
    .upsert({
      user_id: userId,
      expo_push_token: token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    }, { onConflict: "expo_push_token" });
  if (error) throw new Error(error.message);
}
