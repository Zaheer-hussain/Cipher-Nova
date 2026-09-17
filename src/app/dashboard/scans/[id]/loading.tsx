export default function ScanDetailLoading() {
  return (
    <main className="min-h-screen bg-[#f4f6f8] px-6 py-16">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-4 w-36 rounded bg-[#dce5eb]" />
        <div className="mt-8 h-10 w-96 max-w-full rounded bg-[#dce5eb]" />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="h-96 rounded-2xl bg-white" />
          <div className="h-96 rounded-2xl bg-white" />
        </div>
      </div>
    </main>
  );
}
