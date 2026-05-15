import { LegalPage } from "@/app/router/LegalPage";

export function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      updatedAt="15 May 2026"
      intro="These Terms of Service govern your use of StarStrat. They are drafted as a default Australian-law terms set for a game service and should be reviewed for your specific operations before publication."
      sections={[
        {
          title: "Acceptance of terms",
          content: (
            <>
              <p>
                By accessing or using StarStrat, you agree to these Terms of Service and to comply
                with all applicable laws. If you do not agree, you must not use the service.
              </p>
            </>
          ),
        },
        {
          title: "Eligibility and accounts",
          content: (
            <>
              <p>
                You are responsible for the accuracy of information you provide, keeping your account
                credentials secure and all activity that occurs under your account.
              </p>
              <p>
                You must not create accounts or use the service if doing so would breach any law,
                contract or applicable platform rule.
              </p>
            </>
          ),
        },
        {
          title: "Acceptable use",
          content: (
            <>
              <p>You must not use StarStrat to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>interfere with or disrupt the service or other users;</li>
                <li>attempt unauthorised access to accounts, systems or data;</li>
                <li>use cheats, bots, exploits, automation or reverse engineering tools except where allowed by law;</li>
                <li>harass, abuse, threaten or defraud others; or</li>
                <li>upload content that is unlawful, infringing or harmful.</li>
              </ul>
            </>
          ),
        },
        {
          title: "Content and intellectual property",
          content: (
            <>
              <p>
                We own or license the software, artwork, text, logos, game systems and other
                materials that make up StarStrat. You receive a limited, revocable, non-exclusive
                right to use the service for personal, non-commercial gameplay unless we state
                otherwise.
              </p>
              <p>
                If you submit feedback, suggestions or other content, you grant us the right to use
                that material to operate and improve the service, subject to any non-waivable rights
                under Australian law.
              </p>
            </>
          ),
        },
        {
          title: "Availability and changes",
          content: (
            <>
              <p>
                StarStrat may be modified, suspended or discontinued at any time. We may add, remove
                or change game features, rules, balance, content or accessibility with or without
                notice where reasonably required.
              </p>
              <p>
                We do not guarantee uninterrupted or error-free operation.
              </p>
            </>
          ),
        },
        {
          title: "Paid services and refunds",
          content: (
            <>
              <p>
                If we offer paid features, subscriptions or virtual items, the pricing and any
                additional terms will be presented at the point of purchase. Except where required by
                law, payments are non-refundable.
              </p>
              <p>
                Nothing in these Terms excludes, restricts or modifies any consumer guarantee,
                warranty or right that cannot lawfully be excluded under the Australian Consumer Law.
              </p>
            </>
          ),
        },
        {
          title: "Suspension and termination",
          content: (
            <>
              <p>
                We may suspend or terminate access to the service if we reasonably believe you have
                breached these Terms, created a risk to the service or other users, or where required
                by law.
              </p>
            </>
          ),
        },
        {
          title: "Liability",
          content: (
            <>
              <p>
                To the maximum extent permitted by law, we are not liable for indirect or
                consequential loss, lost profits, loss of data or loss of goodwill arising from your
                use of StarStrat.
              </p>
              <p>
                Our liability for a breach of a non-excludable guarantee or warranty is limited, at our
                option, to re-supplying the service or paying the cost of having the service supplied
                again, to the extent permitted by law.
              </p>
            </>
          ),
        },
        {
          title: "Governing law",
          content: (
            <>
              <p>
                These Terms are governed by the laws of Australia and, where applicable, the laws of
                the State or Territory in which the operator of StarStrat is based. The courts of that
                jurisdiction, and any courts able to hear appeals from them, will have non-exclusive
                jurisdiction.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}