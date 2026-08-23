import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { Grok64App } from "@/components/g64/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <>
      <Grok64App />
      <Toaster theme="dark" position="top-center" richColors={false} />
    </>
  );
}
