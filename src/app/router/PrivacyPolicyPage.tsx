import { LegalPage } from "@/app/router/LegalPage";

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt="15 May 2026"
      intro="This Privacy Policy explains how StarStrat collects, uses, stores and discloses personal information in Australia. It is intended as a default policy for a game service operated from Australia and should be tailored to your business practices before publication."
      sections={[
        {
          title: "Who we are",
          content: (
            <>
              <p>
                StarStrat is a game service operated in Australia. In this policy, "we", "us" and
                "our" refer to the operator of StarStrat.
              </p>
              <p>
                We handle personal information in accordance with the Privacy Act 1988 (Cth), the
                Australian Privacy Principles and any other applicable Australian law.
              </p>
            </>
          ),
        },
        {
          title: "Information we collect",
          content: (
            <>
              <p>We may collect the following kinds of information:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Account details such as your name, email address, username and profile settings.</li>
                <li>Gameplay and usage data, including progress, preferences, device information and logs.</li>
                <li>Support communications and any information you choose to provide to us.</li>
                <li>Technical data such as IP address, browser type, operating system and session activity.</li>
              </ul>
              <p>
                We may also collect de-identified or aggregated data for analytics, security and
                service improvement.
              </p>
            </>
          ),
        },
        {
          title: "How we use information",
          content: (
            <>
              <p>We use personal information to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>create and manage accounts;</li>
                <li>provide and improve gameplay, customer support and moderation;</li>
                <li>protect the service, prevent fraud and enforce our rules;</li>
                <li>send service messages and important updates; and</li>
                <li>comply with legal and regulatory obligations in Australia.</li>
              </ul>
            </>
          ),
        },
        {
          title: "Disclosure and storage",
          content: (
            <>
              <p>
                We may disclose personal information to service providers that help us operate the
                game, host infrastructure, process communications or analyse usage. Those providers
                may be located in Australia or overseas.
              </p>
              <p>
                We take reasonable steps to protect personal information from misuse, interference,
                loss, unauthorised access, modification or disclosure. No online service can guarantee
                absolute security, so you should use appropriate care when sharing information.
              </p>
            </>
          ),
        },
        {
          title: "Cookies and similar technologies",
          content: (
            <>
              <p>
                We may use cookies or similar technologies to keep you signed in, remember settings,
                understand how the service is used and improve performance. You can usually control
                cookies through your browser settings, but some features may not function correctly if
                cookies are disabled.
              </p>
            </>
          ),
        },
        {
          title: "Access, correction and complaints",
          content: (
            <>
              <p>
                You may request access to or correction of the personal information we hold about
                you, subject to any legal exceptions. If you believe we have mishandled your personal
                information, contact us so we can investigate and respond.
              </p>
              <p>
                If you are not satisfied with our response, you may be entitled to contact the Office
                of the Australian Information Commissioner or any other relevant authority.
              </p>
            </>
          ),
        },
        {
          title: "Changes to this policy",
          content: (
            <p>
              We may update this Privacy Policy from time to time. The latest version will apply once
              it is published on this page.
            </p>
          ),
        },
      ]}
    />
  );
}