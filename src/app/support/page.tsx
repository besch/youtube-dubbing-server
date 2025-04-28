import Link from "next/link";
import { Mail, HelpCircle } from "lucide-react"; // Assuming lucide-react is installed

export default function SupportPage() {
  const contactEmail = "contact@youtubedubbing.vercel.app"; // Updated domain
  const technicalEmail = "tech-support@youtubedubbing.vercel.app"; // Updated domain
  const helpCenterLink = "#"; // TODO: Add link to help center/FAQ if available

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="text-3xl sm:text-4xl font-bold text-white mb-10">
        Support Center
      </h1>

      {/* FAQ Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-white mb-6">
          Frequently Asked Questions
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-lg text-violet-400 mb-2">
              How accurate is the AI dubbing?
            </h3>
            <p className="text-neutral-400">
              Our AI models for transcription, translation, and text-to-speech
              are state-of-the-art and constantly improving. Accuracy can vary
              based on audio quality, speaker accents, and language complexity.
              We strive for the best possible results, but occasional
              inaccuracies may occur.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-lg text-violet-400 mb-2">
              How do I check the processing status of a video?
            </h3>
            <p className="text-neutral-400">
              When you initiate dubbing for a video, the app will show its
              status (e.g., Downloading, Transcribing, Translating, Generating
              Audio). You can also see the progress in your video history.
              Processing times depend on video length and server load.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-lg text-violet-400 mb-2">
              Can I change the voice or language after processing?
            </h3>
            <p className="text-neutral-400">
              Yes, you can select different supported languages or voices for a
              video you&apos;ve already processed. If the selected combination
              hasn&apos;t been generated yet, the system will initiate the
              necessary steps (translation/audio generation) for the new
              selection.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-lg text-violet-400 mb-2">
              Is my viewing history saved?
            </h3>
            <p className="text-neutral-400">
              Yes, if you are signed in, the app saves your viewing history,
              allowing you to easily revisit videos and see their processing
              status. You can manage or clear your history within the app
              settings.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Support Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-white mb-6">
          Contact Support
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-neutral-800/50 p-6 rounded-lg border border-neutral-700/50">
            <h3 className="font-semibold text-lg text-purple-400 mb-3 flex items-center gap-2">
              <Mail size={18} /> Email Support
            </h3>
            <p className="text-sm text-neutral-400 mb-2">
              For general inquiries and support:
            </p>
            <a
              href={`mailto:${contactEmail}`}
              className="text-violet-400 hover:text-violet-300 transition-colors break-all"
            >
              {contactEmail}
            </a>
            <p className="text-xs text-neutral-500 mt-3">
              We typically respond within 24-48 hours during business days.
            </p>
          </div>
          <div className="bg-neutral-800/50 p-6 rounded-lg border border-neutral-700/50">
            <h3 className="font-semibold text-lg text-purple-400 mb-3 flex items-center gap-2">
              <Mail size={18} /> Technical Support
            </h3>
            <p className="text-sm text-neutral-400 mb-2">
              For technical issues and bug reports:
            </p>
            <a
              href={`mailto:${technicalEmail}`}
              className="text-violet-400 hover:text-violet-300 transition-colors break-all"
            >
              {technicalEmail}
            </a>
            <p className="text-xs text-neutral-500 mt-3">
              Please include your device model and app version.
            </p>
          </div>
        </div>
      </section>

      {/* Business Hours Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-white mb-6">
          Business Hours
        </h2>
        <div className="bg-neutral-800/50 p-6 rounded-lg border border-neutral-700/50">
          <p className="text-neutral-400">
            Monday - Friday: 9:00 AM - 6:00 PM (EST) <br />
            {/* Saturday: 10:00 AM - 4:00 PM (EST) // Optional */}
          </p>
          <p className="text-sm text-neutral-500 mt-3">
            For urgent matters outside business hours, please email us, and
            we&apos;ll respond as soon as possible.
          </p>
        </div>
      </section>

      {/* Help Center Link */}
      {helpCenterLink !== "#" && (
        <section>
          <div className="text-center">
            <Link
              href={helpCenterLink}
              className="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 transition-colors"
            >
              <HelpCircle size={20} /> Need immediate assistance? Visit our Help
              Center
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
