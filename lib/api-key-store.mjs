const memorySecrets = new Map([
  ["apiKey", String(process.env.LEARNING_TRACKER_API_KEY || "")],
  ["subscriptionKey", String(process.env.LEARNING_TRACKER_SUBSCRIPTION_KEY || "")],
]);

let storage = {
  kind: "session",
  persistent: false,
  async get(name) {
    return memorySecrets.get(name) || "";
  },
  async set(name, value) {
    memorySecrets.set(name, value);
  },
};

export function configureApiKeyStorage(adapter) {
  if (!adapter || typeof adapter.get !== "function" || typeof adapter.set !== "function") {
    throw new TypeError("Secret storage adapter is invalid");
  }
  storage = {
    kind: String(adapter.kind || "custom"),
    persistent: Boolean(adapter.persistent),
    get: adapter.get,
    set: adapter.set,
  };
}

export async function getSecret(name) {
  return String((await storage.get(name)) || "");
}

export async function setSecret(name, value) {
  await storage.set(name, String(value || "").trim());
}

export async function getSecretInfo(name) {
  return {
    configured: Boolean(await getSecret(name)),
    storage: storage.kind,
    persistent: storage.persistent,
  };
}

export function getApiKey() {
  return getSecret("apiKey");
}

export function setApiKey(value) {
  return setSecret("apiKey", value);
}

export function getApiKeyInfo() {
  return getSecretInfo("apiKey");
}

export function getSubscriptionKey() {
  return getSecret("subscriptionKey");
}

export function setSubscriptionKey(value) {
  return setSecret("subscriptionKey", value);
}

export function getSubscriptionKeyInfo() {
  return getSecretInfo("subscriptionKey");
}
