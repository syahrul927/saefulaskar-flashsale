"use client";

import { useState, type FormEvent } from "react";

import { useRouter } from "next/navigation";
import { RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

function AuthForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/jubelio-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push("/admin");
        return;
      }

      let message = "Username atau Password salah!";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error?.includes("Company tidak valid")) {
          message = "Company tidak valid";
        }
      } catch {
        // Non-JSON error body — fall back to the generic message.
      }
      setError(message);
      toast.error(message);
    } catch {
      setError("Username atau Password salah!");
      toast.error("Username atau Password salah!");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field>
        <FieldLabel htmlFor="jubelio-email">Email / Username</FieldLabel>
        <Input
          id="jubelio-email"
          name="email"
          type="text"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          className="h-11"
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="jubelio-password">Password</FieldLabel>
        <InputGroup className="h-11">
          <InputGroupInput
            id="jubelio-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            className="h-11"
            aria-invalid={error ? true : undefined}
            required
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-sm"
              aria-label={
                showPassword ? "Sembunyikan password" : "Tampilkan password"
              }
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      {error ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="mark"
        size="lg"
        className="h-11 w-full"
        disabled={isLoading}
      >
        {isLoading ? <Spinner /> : "Masuk"}
      </Button>
    </form>
  );
}

export { AuthForm };
