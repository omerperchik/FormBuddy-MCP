import admin from "firebase-admin";
import type { Config } from "../config.js";

let initialized = false;

export function initFirebase(config: Config): void {
  if (initialized || !config.firebase.enabled) return;

  const opts: admin.AppOptions = {
    storageBucket: config.firebase.storageBucket ?? undefined,
  };

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    opts.credential = admin.credential.applicationDefault();
  }
  if (config.firebase.projectId) {
    opts.projectId = config.firebase.projectId;
  }

  admin.initializeApp(opts);
  initialized = true;
}

function db(): admin.firestore.Firestore {
  return admin.firestore();
}

function bucket(): ReturnType<admin.storage.Storage["bucket"]> {
  return admin.storage().bucket();
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

function docToProfile(doc: admin.firestore.DocumentSnapshot): Profile {
  const data = doc.data()!;
  return {
    id: doc.id,
    userId: data.userId,
    name: data.name,
    type: data.type,
    fields: data.fields ?? {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function listProfiles(userId: string): Promise<Profile[]> {
  const snapshot = await db()
    .collection("profiles")
    .where("userId", "==", userId)
    .orderBy("updatedAt", "desc")
    .get();

  return snapshot.docs.map(docToProfile);
}

export async function getProfile(userId: string, profileId: string): Promise<Profile | null> {
  const doc = await db().collection("profiles").doc(profileId).get();
  if (!doc.exists) return null;
  const profile = docToProfile(doc);
  if (profile.userId !== userId) return null;
  return profile;
}

export async function createProfile(
  userId: string,
  data: { name: string; type: Profile["type"]; fields: Record<string, string> }
): Promise<Profile> {
  const now = new Date().toISOString();
  const payload = { userId, name: data.name, type: data.type, fields: data.fields, createdAt: now, updatedAt: now };
  const ref = await db().collection("profiles").add(payload);
  return { id: ref.id, ...payload };
}

export async function updateProfile(
  userId: string,
  profileId: string,
  updates: { name?: string; type?: Profile["type"]; fields?: Record<string, string> }
): Promise<Profile | null> {
  const ref = db().collection("profiles").doc(profileId);
  const doc = await ref.get();
  if (!doc.exists) return null;

  const existing = docToProfile(doc);
  if (existing.userId !== userId) return null;

  // Merge fields rather than replace
  const mergedFields = updates.fields
    ? { ...existing.fields, ...updates.fields }
    : existing.fields;

  const patch = {
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.type !== undefined && { type: updates.type }),
    fields: mergedFields,
    updatedAt: new Date().toISOString(),
  };

  await ref.update(patch);
  return { ...existing, ...patch };
}

export async function deleteProfile(userId: string, profileId: string): Promise<boolean> {
  const ref = db().collection("profiles").doc(profileId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  const profile = docToProfile(doc);
  if (profile.userId !== userId) return false;
  await ref.delete();
  return true;
}

// ── Document storage ──

export async function uploadDocument(
  userId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<{ url: string; path: string }> {
  const storagePath = `documents/${userId}/${Date.now()}_${fileName}`;
  const file = bucket().file(storagePath);

  await file.save(buffer, { contentType, resumable: false });
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 3600 * 1000,
  });

  return { url, path: storagePath };
}

export async function getDocumentBuffer(storagePath: string): Promise<Buffer> {
  const [buffer] = await bucket().file(storagePath).download();
  return buffer;
}

// ── Template operations ──

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  storagePath: string;
  fieldCount: number;
}

function docToTemplate(doc: admin.firestore.DocumentSnapshot): FormTemplate {
  const data = doc.data()!;
  return {
    id: doc.id,
    name: data.name,
    description: data.description ?? "",
    category: data.category ?? "general",
    tags: data.tags ?? [],
    storagePath: data.storagePath,
    fieldCount: data.fieldCount ?? 0,
  };
}

export async function listTemplates(category?: string, search?: string): Promise<FormTemplate[]> {
  let query: admin.firestore.Query = db().collection("templates");

  if (category) {
    query = query.where("category", "==", category);
  }

  const snapshot = await query.get();
  let templates = snapshot.docs.map(docToTemplate);

  // Client-side search filter (Firestore doesn't support full-text search)
  if (search) {
    const term = search.toLowerCase();
    templates = templates.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        t.description.toLowerCase().includes(term) ||
        t.tags.some((tag) => tag.toLowerCase().includes(term))
    );
  }

  return templates;
}

export async function getTemplate(templateId: string): Promise<FormTemplate | null> {
  const doc = await db().collection("templates").doc(templateId).get();
  if (!doc.exists) return null;
  return docToTemplate(doc);
}
