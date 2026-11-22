"use client";

import { Camera, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { browserDb } from "@/lib/supabase/browser";
import { changePassword, removeAvatar, updateAvatar, updateProfile } from "../../../auth-actions";

const input = "min-h-12 w-full rounded-xl border border-line bg-white px-3.5 text-[16px] outline-none focus:border-ink disabled:bg-surface disabled:text-muted";
type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-semibold ${m.ok ? "text-success" : "text-sale"}`}>{m.text}</p> : null);

export function ProfileForm({ name, phone, email, avatarUrl }: { name: string; phone: string; email: string; avatarUrl: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name, phone });
  const [msg, setMsg] = useState<Msg>(null);
  const [avatarMsg, setAvatarMsg] = useState<Msg>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, start] = useTransition();
  const initial = name.trim()[0]?.toUpperCase() ?? "F";

  async function uploadAvatar(file?: File) {
    if (!file) return;
    setAvatarMsg(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarMsg({ ok: false, text: "Choose a JPG, PNG or WebP image." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarMsg({ ok: false, text: "The image must be 2 MB or smaller." });
      return;
    }
    setAvatarBusy(true);
    try {
      const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      const path = `${(await browserDb().auth.getUser()).data.user?.id}/avatar-${Date.now().toString(36)}.${ext}`;
      if (path.startsWith("undefined/")) throw new Error("Sign in again to upload a photo.");
      const { error } = await browserDb().storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "3600",
      });
      if (error) throw error;
      const saved = await updateAvatar(path);
      if (!saved.ok) throw new Error(saved.message);
      setAvatarMsg({ ok: true, text: "Profile photo updated." });
      router.refresh();
    } catch (error) {
      setAvatarMsg({ ok: false, text: error instanceof Error ? error.message : "Couldn’t upload your photo. Try again." });
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearAvatar() {
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const result = await removeAvatar();
      if (!result.ok) throw new Error(result.message);
      setAvatarMsg({ ok: true, text: "Profile photo removed." });
      router.refresh();
    } catch (error) {
      setAvatarMsg({ ok: false, text: error instanceof Error ? error.message : "Couldn’t remove your photo. Try again." });
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateProfile(f).catch(() => ({ ok: false as const, message: "You seem to be offline. Try again." }));
          setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.message });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="flex items-center gap-4 rounded-xl bg-surface p-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Your profile" className="size-16 shrink-0 rounded-full border-2 border-ink object-cover" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-ink text-xl font-extrabold text-white">{initial}</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="text-[13px]">Profile photo</strong>
          <span className="text-[12px] text-muted">JPG, PNG or WebP · Up to 2 MB</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" disabled={avatarBusy} onClick={() => fileRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-bold text-white disabled:opacity-60">
              {avatarBusy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {avatarUrl && <button type="button" disabled={avatarBusy} onClick={clearAvatar} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] font-bold disabled:opacity-60"><Trash2 size={14} />Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
        </div>
      </div>
      <Note m={avatarMsg} />
      <label className="flex flex-col gap-1 text-[13px] font-bold">Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" className={input} /></label>
      <label className="flex flex-col gap-1 text-[13px] font-bold">Phone (for pickup codes)<input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0803 000 0000" autoComplete="tel" className={input} /></label>
      <label className="flex flex-col gap-1 text-[13px] font-bold">Email<input value={email} disabled className={input} /></label>
      <Note m={msg} />
      <button type="submit" disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink font-bold text-white disabled:opacity-60">{busy && <Loader2 aria-hidden size={16} className="animate-spin" />}Save</button>
    </form>
  );
}

export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await changePassword(pw).catch(() => ({ ok: false as const, message: "You seem to be offline. Try again." }));
          setMsg(r.ok ? { ok: true, text: "Password changed" } : { ok: false, text: r.message });
          if (r.ok) setPw("");
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] font-bold">New password<input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8+ characters, with a number" className={input} /></label>
      <Note m={msg} />
      <button type="submit" disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-ink font-bold disabled:opacity-60">{busy && <Loader2 aria-hidden size={16} className="animate-spin" />}Change password</button>
    </form>
  );
}
