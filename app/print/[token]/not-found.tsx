import { QrCode } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-200">
        <QrCode className="h-8 w-8 text-gray-400" />
      </div>
      <h1 className="text-xl font-bold text-gray-900">Código QR no válido</h1>
      <p className="mt-2 text-sm text-gray-500">
        Este enlace no es válido o ha sido desactivado.
        <br />
        Solicita un nuevo código QR en el mostrador.
      </p>
    </div>
  );
}
