export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-[#f4f6f8] px-6 py-16 text-[#102a43]">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-3 w-28 rounded bg-[#dce5eb]" />
        <div className="mt-4 h-10 w-80 rounded bg-[#dce5eb]" />
        <div className="mt-3 h-5 w-[28rem] max-w-full rounded bg-[#e4ebef]" />
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div className="h-[27rem] rounded-2xl bg-white" />
          <div className="h-[27rem] rounded-2xl bg-white" />
        </div>
      </div>
    </main>
  );
}
