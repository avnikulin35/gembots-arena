import Link from 'next/link';

export const metadata = {
  title: 'GemBots Chat — Coming Soon',
  description: 'Community chat for GemBots Arena. Coming soon.',
};

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-6">💬</div>
        <h1 className="text-3xl font-bold text-white mb-4">Chat — Coming Soon</h1>
        <p className="text-gray-400 mb-8">
          Community chat for GemBots Arena is in development.
        </p>
        <Link 
          href="/watch"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
        >
          ⚔️ Watch Battles
        </Link>
      </div>
    </main>
  );
}
