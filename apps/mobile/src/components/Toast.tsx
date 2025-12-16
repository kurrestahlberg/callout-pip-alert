// Toast notification component - displays temporary messages

interface ToastMessage {
  id: string;
  message: string;
  type: "info" | "success" | "warning";
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  const typeStyles = {
    info: "bg-amber-500/20 border-amber-500/50 text-amber-500",
    success: "bg-green-500/20 border-green-500/50 text-green-500",
    warning: "bg-red-500/20 border-red-500/50 text-red-500",
  };

  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto p-3 rounded border-2 font-mono text-sm animate-slide-in ${typeStyles[toast.type]}`}
          onClick={() => onDismiss(toast.id)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1">{toast.message}</span>
            <button className="opacity-60 hover:opacity-100 text-xs">[X]</button>
          </div>
        </div>
      ))}
    </div>
  );
}
