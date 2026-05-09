import { Bell, User } from "lucide-react";
import type { Profile } from "@/types";

interface AdminHeaderProps {
  profile: Profile | null;
  title?: string;
}

export function AdminHeader({ profile, title }: AdminHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div>
        {title && (
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
            <User className="h-4 w-4 text-blue-700" />
          </div>
          {profile && (
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-900">
                {profile.full_name}
              </p>
              <p className="text-xs text-gray-500 capitalize">{profile.role}</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
