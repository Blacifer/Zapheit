interface MobileBottomSheetProps {
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileBottomSheet({ onClose, children }: MobileBottomSheetProps) {
  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-h-[85vh] rounded-t-2xl overflow-y-auto bg-[#080f1a] border-t border-white/[0.08]">
        {children}
      </div>
    </div>
  );
}
