import { AuthForm } from "@/components/auth-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Masuk - Saeful Askar",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-svh flex-col justify-between bg-background">
      <div className="flex min-h-svh flex-col px-4">
        <div className="flex flex-col items-start gap-1.5 pt-16 md:pt-24">
          <h1 className="font-heading text-3xl font-semibold text-foreground">
            Saeful Askar
          </h1>
          <p className="text-sm text-muted-foreground">
            Masuk menggunakan akun Jubelio kamu!
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-center py-8">
          <Card className="w-full max-w-sm rounded-xl">
            <CardContent>
              <AuthForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
