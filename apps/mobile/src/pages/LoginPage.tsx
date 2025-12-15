import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useNavigation } from "../lib/navigation";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, signUp, confirmSignUp, signInWithBiometric, isConfigured, canUseBiometric, biometricType } = useAuth();
  const { navigate } = useNavigation();

  // Note: Auto-biometric login disabled - user must tap the biometric button
  // useEffect(() => {
  //   if (canUseBiometric && isConfigured) {
  //     handleBiometricLogin();
  //   }
  // }, [canUseBiometric, isConfigured]);

  async function handleBiometricLogin() {
    setError("");
    setIsLoading(true);

    try {
      const success = await signInWithBiometric();
      if (success) {
        navigate("incidents");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric login failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isConfirming) {
        await confirmSignUp(email, confirmCode);
        setIsConfirming(false);
        setIsSignUp(false);
        setError("ACCOUNT CONFIRMED. PROCEED WITH LOGIN.");
      } else if (isSignUp) {
        await signUp(email, password, name);
        setIsConfirming(true);
      } else {
        await signIn(email, password);
        navigate("incidents");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-zinc-900 crt-effect">
      <div className="w-full max-w-sm">
        {/* Terminal Header */}
        <div className="border-2 border-amber-500/50 rounded-t-lg bg-zinc-800 px-4 py-2 flex items-center gap-2 border-glow">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-2 text-amber-500/70 text-xs font-mono">RIFF-BOY v0.1.0</span>
        </div>

        {/* Main Terminal */}
        <div className="border-2 border-t-0 border-amber-500/50 rounded-b-lg bg-zinc-900 p-6 border-glow">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-amber-500 font-mono tracking-wider text-glow">RIFF-BOY</h1>
            <p className="text-amber-500/60 font-mono text-sm mt-1">{">"} INCIDENT MANAGEMENT SYSTEM</p>
          </div>

          {!isConfigured && (
            <div className="mb-6 p-4 border border-amber-500/50 rounded bg-amber-500/10">
              <p className="text-amber-500 text-sm font-mono mb-3">
                [WARNING] NO BACKEND CONFIGURED
              </p>
              <button
                onClick={() => navigate("settings")}
                className="block w-full py-2 bg-amber-500 text-zinc-900 rounded font-mono font-bold text-center hover:bg-amber-400"
              >
                CONFIGURE BACKEND
              </button>
            </div>
          )}

          {/* Biometric Login Button */}
          {canUseBiometric && !isSignUp && !isConfirming && (
            <button
              onClick={handleBiometricLogin}
              disabled={isLoading}
              className="w-full py-3 mb-4 bg-green-500/20 border-2 border-green-500 text-green-500 rounded font-mono font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-green-500/30"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              USE {biometricType.toUpperCase()}
            </button>
          )}

          {canUseBiometric && !isSignUp && !isConfirming && (
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-amber-500/30" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-zinc-900 text-amber-500/50 font-mono">OR</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && !isConfirming && (
              <div>
                <label className="block text-amber-500/70 font-mono text-xs mb-1">{">"} NAME</label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded bg-zinc-800 border-2 border-amber-500/30 text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                  required
                />
              </div>
            )}

            {!isConfirming && (
              <>
                <div>
                  <label className="block text-amber-500/70 font-mono text-xs mb-1">{">"} EMAIL</label>
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded bg-zinc-800 border-2 border-amber-500/30 text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                    required
                  />
                </div>
                <div>
                  <label className="block text-amber-500/70 font-mono text-xs mb-1">{">"} PASSWORD</label>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded bg-zinc-800 border-2 border-amber-500/30 text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                    required
                  />
                </div>
              </>
            )}

            {isConfirming && (
              <div>
                <label className="block text-amber-500/70 font-mono text-xs mb-1">{">"} CONFIRMATION CODE</label>
                <input
                  type="text"
                  placeholder="Enter code from email"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="w-full px-4 py-3 rounded bg-zinc-800 border-2 border-amber-500/30 text-amber-500 font-mono placeholder-amber-500/30 focus:outline-none focus:border-amber-500 text-base"
                  required
                />
              </div>
            )}

            {error && (
              <div className="p-2 border border-red-500/50 rounded bg-red-500/10">
                <p className="text-red-500 text-sm font-mono text-center">[ERROR] {error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-amber-500 text-zinc-900 rounded font-mono font-bold hover:bg-amber-400 disabled:opacity-50"
            >
              {isLoading
                ? "PROCESSING..."
                : isConfirming
                ? "CONFIRM"
                : isSignUp
                ? "REGISTER"
                : "LOGIN"}
            </button>
          </form>

          {!isConfirming && (
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              className="w-full mt-4 text-amber-500/70 text-sm font-mono hover:text-amber-500"
            >
              {isSignUp ? "{"<"} BACK TO LOGIN" : "{">"} CREATE NEW ACCOUNT"}
            </button>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-amber-500/30 font-mono text-xs mt-4">
          VAULT-TEC APPROVED INCIDENT RESPONSE
        </p>
      </div>
    </div>
  );
}
