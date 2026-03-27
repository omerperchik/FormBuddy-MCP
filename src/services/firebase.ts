import admin from "firebase-admin";

let initialized = false;

export function initFirebase(): void {
  if (initialized) return;

  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountPath) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket: `${projectId}.firebasestorage.app`,
    });
  } else {
    admin.initializeApp({
      projectId: projectId || "formbuddy",
      storageBucket: `${projectId || "formbuddy"}.firebasestorage.app`,
    });
  }

  initialized = true;
}

export function getFirestore(): admin.firestore.Firestore {
  return admin.firestore();
}

export function getStorage(): admin.storage.Storage {
  return admin.storage();
}

export function getAuth(): admin.auth.Auth {
  return admin.auth();
}

// ── Profile operations ──

export interface Profile {
  id: string;
  userId: string;
  name: string;
  type: "personal" | "business" | "family";
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export async function listProfiles(userId: string): Promise<Profile[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection("profiles")
    .where("userId", "==", userId)
    .get();

  return snapshot.docs.map((doc) => {
    const { id: _, ...data } = doc.data() as Profile;
    return { ...data, id: doc.id } as Profile;
  });
}

export async function getProfile(
  userId: string,
  profileId: string
): Promise<Profile | null> {
  const db = getFirestore();
  const doc = await db.collection("profiles").doc(profileId).get();

  if (!doc.exists) return null;
  const { id: _, ...data } = doc.data() as Profile;
  if (data.userId !== userId) return null;

  return { ...data, id: doc.id } as Profile;
}

export async function createProfile(
  userId: string,
  data: { name: string; type: Profile["type"]; fields: Record<string, string> }
): Promise<Profile> {
  const db = getFirestore();
  const now = new Date().toISOString();

  const profile = {
    userId,
    name: data.name,
    type: data.type,
    fields: data.fields,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await db.collection("profiles").add(profile);
  return { id: ref.id, ...profile };
}

export async function updateProfile(
  userId: string,
  profileId: string,
  updates: { name?: string; type?: Profile["type"]; fields?: Record<string, string> }
): Promise<Profile | null> {
  const db = getFirestore();
  const doc = await db.collection("profiles").doc(profileId).get();

  if (!doc.exists) return null;
  const existing = doc.data() as Profile;
  if (existing.userId !== userId) return null;

  const patch = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await db.collection("profiles").doc(profileId).update(patch);

  const { id: _, ...existingData } = existing;
  return { ...existingData, ...patch, id: profileId } as Profile;
}

// ── Document storage operations ──

export async function uploadDocument(
  userId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `documents/${userId}/${Date.now()}_${fileName}`;
  const file = bucket.file(path);

  await file.save(buffer, { contentType, resumable: false });
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 3600 * 1000, // 1 hour
  });

  return url;
}

export async function getDocumentBuffer(storagePath: string): Promise<Buffer> {
  const bucket = getStorage().bucket();
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

// ── Form template operations ──

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  storagePath: string;
}

export async function listTemplates(
  category?: string
): Promise<FormTemplate[]> {
  const db = getFirestore();
  let query: admin.firestore.Query = db.collection("templates");

  if (category) {
    query = query.where("category", "==", category);
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => {
    const { id: _, ...data } = doc.data() as FormTemplate;
    return { ...data, id: doc.id } as FormTemplate;
  });
}

export async function getTemplate(
  templateId: string
): Promise<FormTemplate | null> {
  const db = getFirestore();
  const doc = await db.collection("templates").doc(templateId).get();
  if (!doc.exists) return null;
  const { id: _, ...data } = doc.data() as FormTemplate;
  return { ...data, id: doc.id } as FormTemplate;
}
