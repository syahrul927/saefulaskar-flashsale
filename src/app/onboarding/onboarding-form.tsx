"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";

/** Form fields map to Jubelio `saveContactRequest` (spec §4.1). */
function OnboardingForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const [contactName, setContactName] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [contactPosition, setContactPosition] = useState("pemilik");
  const [phone, setPhone] = useState("");
  const [sAddress, setSAddress] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName,
          primaryContact,
          contactPosition,
          phone,
          sAddress,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menyimpan, coba lagi.");
        return;
      }
      toast.success("Profil tersimpan! Selamat berbelanja.");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field>
        <FieldLabel htmlFor="contact-name">Nama toko/perusahaan</FieldLabel>
        <Input
          id="contact-name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          disabled={isLoading}
          className="h-11"
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="primary-contact">Nama PIC</FieldLabel>
        <Input
          id="primary-contact"
          value={primaryContact}
          onChange={(e) => setPrimaryContact(e.target.value)}
          disabled={isLoading}
          className="h-11"
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="contact-position">Jabatan</FieldLabel>
        <NativeSelect
          id="contact-position"
          value={contactPosition}
          onChange={(e) => setContactPosition(e.target.value)}
          disabled={isLoading}
        >
          <option value="pemilik">Pemilik</option>
          <option value="procurement">Procurement</option>
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor="phone">No. Telf PIC</FieldLabel>
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={isLoading}
          className="h-11"
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="s-address">Alamat lengkap</FieldLabel>
        <Textarea
          id="s-address"
          value={sAddress}
          onChange={(e) => setSAddress(e.target.value)}
          disabled={isLoading}
          rows={3}
          required
        />
      </Field>

      <Button type="submit" size="lg" className="h-11 w-full" disabled={isLoading}>
        {isLoading ? <Spinner /> : null}
        {isLoading ? "Menyimpan..." : "Simpan & Mulai Belanja"}
      </Button>
    </form>
  );
}

export { OnboardingForm };