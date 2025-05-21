import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription",
  description: "Choose your subscription plan",
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
