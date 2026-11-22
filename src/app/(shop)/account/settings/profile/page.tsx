import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getMe } from "@/lib/data/me";
import { DataRights } from "../../data-rights";
import { Panel, SettingsShell } from "../ui";
import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Manage my account", robots: { index: false } };

export default function ProfilePage() {
  return (
    <SettingsShell title="Manage my account">
      <Suspense fallback={
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-4 bg-white p-4 md:rounded-2xl md:border md:border-line">
            <div className="h-5 w-20 animate-pulse rounded bg-[#EDEDED]" />
            <div className="h-24 animate-pulse rounded-xl bg-[#EDEDED]" />
            <div className="h-12 animate-pulse rounded-xl bg-[#EDEDED]" />
            <div className="h-12 animate-pulse rounded-xl bg-[#EDEDED]" />
            <div className="h-12 animate-pulse rounded-xl bg-[#EDEDED]" />
          </div>
          <div className="h-36 animate-pulse rounded-xl bg-[#EDEDED]" />
        </div>
      }>
        <Body />
      </Suspense>
    </SettingsShell>
  );
}

async function Body() {
  await connection();
  const me = await getMe();
  if (!me) redirect("/sign-in?mode=signin&next=/account/settings/profile");
  return (
    <>
      <Panel>
        <h2 className="text-[15px] font-bold">Profile</h2>
        <ProfileForm name={me.name} phone={me.phone?.replace(/^\+234/, "0") ?? ""} email={me.email ?? ""} avatarUrl={me.avatarUrl} />
      </Panel>
      <Panel>
        <h2 className="text-[15px] font-bold">Password</h2>
        <PasswordForm />
      </Panel>
      <Panel>
        <h2 className="text-[15px] font-bold">Your data</h2>
        <p className="text-[13px] text-muted">Download a copy of everything we hold about you, or delete your account (Nigeria Data Protection Act 2023).</p>
        <DataRights />
      </Panel>
    </>
  );
}
