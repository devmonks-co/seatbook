export default function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <div className="w-16 h-16 border-4 border-[#a855f7] border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-6 text-white/60 animate-pulse">{label}</p>
    </div>
  );
}
