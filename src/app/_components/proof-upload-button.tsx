"use client";

import { useRef, useState } from "react";
import { UploadIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Client-side "Upload Bukti Transfer" control. Picks a file, POSTs it to
 * `POST /api/orders/[id]/upload-proof`, and surfaces success/failure via toast.
 *
 * Restyle (Task 13) — mockup secondary CTA treatment (design.html:1141-1144:
 * full-width, grey fill, small semibold label); upload/fetch behaviour is
 * unchanged. Stacks full-width in `PaymentPanel` footers and wraps to its own
 * line inside the orders-page action row.
 *
 * Success also triggers `router.refresh()` (final review I-3): the uploaded
 * proof lives on the server row, so without a re-render of the RSC data the
 * orders card badge and the receipt's proof line would keep claiming "no
 * proof". A client RSC refresh keeps component state (the drawer stays open,
 * dialogs survive), and with the panel's list poll now usually absent
 * (orderId contract) this refresh is what flips the badge.
 */
function ProofUploadButton({ orderId }: { orderId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/orders/${orderId}/upload-proof`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Upload gagal, coba lagi.");
        return;
      }
      toast.success("Bukti transfer terkirim!");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="secondary"
        className="w-full text-xs font-semibold"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Spinner /> : <UploadIcon />}
        {uploading ? "Mengunggah..." : "Upload Bukti Transfer"}
      </Button>
    </>
  );
}

export { ProofUploadButton };