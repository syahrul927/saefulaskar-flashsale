import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/server/better-auth/server";

export const metadata = {
  title: "Login Berhasil - Saeful Askar",
};

export default async function LoginSuccessPage() {
  const session = await getSession();

  if (!session) {
    redirect("/auth/login");
  }

  const displayName =
    session.user.fullName.trim() !== ""
      ? session.user.fullName
      : session.user.name;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center font-heading text-xl font-semibold text-foreground">
          Saeful Askar
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Login Berhasil</CardTitle>
            <CardDescription>Halo, {displayName}</CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
