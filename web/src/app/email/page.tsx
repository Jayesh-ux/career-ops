import type { Metadata } from "next";
import { EmailTriage } from "@/components/email-triage";

export const metadata: Metadata = {
  title: "Email Triage — career-ops",
  description: "Classify and respond to employer replies",
};

export default function EmailPage() {
  return <EmailTriage />;
}
