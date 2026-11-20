import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { registerPushToken, requestPushPermission } from "../lib/notifications";

type PermissionScreenProps = {
  userId: string;
  onDone: () => void;
  onNotice: (message: string) => void;
};

export default function PermissionScreen({ userId, onDone, onNotice }: PermissionScreenProps) {
  const [busy, setBusy] = useState(false);

  async function onContinue() {
    if (busy) return;
    setBusy(true);
    onNotice("");
    try {
      const granted = await requestPushPermission();
      if (granted) {
        await registerPushToken(userId);
      } else {
        onNotice("Push permission is off. You can enable notifications in your phone settings.");
      }
    } catch (error: unknown) {
      onNotice(error instanceof Error ? error.message : "Could not register this phone for push notifications.");
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>🔔</Text>
        </View>
        <Text style={styles.title}>Stay in the loop</Text>
        <Text style={styles.body}>
          Get timely reminders and direct updates from your accounting manager. Tap Continue to choose whether to allow notifications.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void onContinue()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}
      >
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#f7f9f8" },
  card: { alignItems: "center", marginBottom: 18, padding: 24, borderWidth: 1, borderColor: "#e8edeb", borderRadius: 16, backgroundColor: "#fff" },
  iconWrap: { width: 68, height: 68, alignItems: "center", justifyContent: "center", marginBottom: 18, borderRadius: 22, backgroundColor: "#eaf5ee" },
  icon: { fontSize: 34 },
  title: { color: "#18211f", fontSize: 22, fontWeight: "700", textAlign: "center" },
  body: { marginTop: 10, color: "#77817f", fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#0d716b" },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
});
