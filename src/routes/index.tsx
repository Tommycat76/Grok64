import "@/lib/emu/grok64-core-bootstrap";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { Grok64App } from "@/components/emu/Grok64App";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <Grok64App />
      <Toaster theme="dark" position="bottom-center" richColors={false} className="g64-toaster" />
    </>
  );
}
