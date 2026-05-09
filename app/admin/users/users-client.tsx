"use client";

import { useState, useTransition } from "react";
import { Plus, UserCheck, UserX, Shield, User, Pencil, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Card } from "@/components/ui/card";
import { createUser, updateUser, updateUserRole, toggleUserActive, deleteUser, changeUserPassword } from "./actions";
import { cn, formatShortDate } from "@/lib/utils";
import type { Profile } from "@/types";

interface UsersClientProps {
  users: Profile[];
  currentUserId: string;
}

export function UsersClient({ users, currentUserId }: UsersClientProps) {
  const [addOpen, setAddOpen]           = useState(false);
  const [editUser, setEditUser]         = useState<Profile | null>(null);
  const [pwdUser, setPwdUser]           = useState<Profile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError]   = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  function showSuccess(msg: string) {
    setFormSuccess(msg);
    setTimeout(() => setFormSuccess(null), 3000);
  }

  // ── Crear ──────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createUser(formData);
      if (result.success) {
        setAddOpen(false);
        showSuccess("Usuario creado correctamente");
      } else {
        setFormError(result.error ?? "Error al crear usuario");
      }
    });
  }

  // ── Editar ─────────────────────────────────────────────
  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editUser) return;
    setFormError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateUser(editUser.id, formData);
      if (result.success) {
        setEditUser(null);
        showSuccess("Usuario actualizado correctamente");
      } else {
        setFormError(result.error ?? "Error al actualizar usuario");
      }
    });
  }

  // ── Eliminar ───────────────────────────────────────────
  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteUser(deleteTarget.id);
      if (result.success) {
        setDeleteTarget(null);
        showSuccess("Usuario eliminado");
      } else {
        setDeleteTarget(null);
        showSuccess("Error: " + (result.error ?? "No se pudo eliminar"));
      }
    });
  }

  // ── Cambiar contraseña ────────────────────────────────
  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pwdUser) return;
    setFormError(null);
    const formData = new FormData(e.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm  = String(formData.get("confirm") ?? "");
    if (password !== confirm) {
      setFormError("Las contraseñas no coinciden");
      return;
    }
    startTransition(async () => {
      const result = await changeUserPassword(pwdUser.id, password);
      if (result.success) {
        setPwdUser(null);
        showSuccess("Contraseña actualizada correctamente");
      } else {
        setFormError(result.error ?? "Error al cambiar contraseña");
      }
    });
  }

  function handleRoleChange(userId: string, role: string) {
    startTransition(() => { void updateUserRole(userId, role as "admin" | "operator"); });
  }

  function handleToggle(userId: string, isActive: boolean) {
    startTransition(() => { void toggleUserActive(userId, isActive); });
  }

  return (
    <>
      {/* Barra superior */}
      <div className="mb-4 flex items-center justify-between">
        {formSuccess ? (
          <p className="text-sm text-green-600">✓ {formSuccess}</p>
        ) : (
          <span />
        )}
        <Button onClick={() => { setFormError(null); setAddOpen(true); }}>
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      {/* Tabla */}
      <Card noPadding>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Usuario</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Rol</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Creado</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                {/* Nombre / email */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
                      {u.role === "admin" ? (
                        <Shield className="h-4 w-4 text-blue-700" />
                      ) : (
                        <User className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{u.full_name}</p>
                      <p className="text-xs text-gray-500">{u.email}</p>
                    </div>
                  </div>
                </td>

                {/* Rol */}
                <td className="px-4 py-3">
                  {u.id === currentUserId ? (
                    <span className="text-sm capitalize text-gray-700">{u.role}</span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={isPending}
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operador</option>
                    </select>
                  )}
                </td>

                {/* Estado */}
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  )}>
                    {u.is_active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                    {u.is_active ? "Activo" : "Inactivo"}
                  </span>
                </td>

                {/* Fecha */}
                <td className="px-4 py-3 text-xs text-gray-500">
                  {formatShortDate(u.created_at)}
                </td>

                {/* Acciones */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {/* Editar */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => { setFormError(null); setEditUser(u); }}
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>

                    {/* Cambiar contraseña */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => { setFormError(null); setPwdUser(u); }}
                      title="Cambiar contraseña"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>

                    {u.id !== currentUserId && (
                      <>
                        {/* Activar / Desactivar */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => handleToggle(u.id, !u.is_active)}
                        >
                          {u.is_active ? "Desactivar" : "Activar"}
                        </Button>

                        {/* Eliminar */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => setDeleteTarget(u)}
                          className="text-red-500 hover:bg-red-50 hover:text-red-700"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Modal — Crear usuario */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Crear usuario" className="max-w-md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input name="full_name" label="Nombre completo" required placeholder="Ej: Juan García" />
          <Input name="email" label="Correo electrónico" type="email" required placeholder="juan@empresa.com" />
          <Input
            name="password"
            label="Contraseña"
            type="password"
            required
            placeholder="Mínimo 6 caracteres"
            hint="El usuario podrá cambiarla después"
          />
          <Select
            name="role"
            label="Rol"
            defaultValue="operator"
            options={[
              { value: "operator", label: "Operador" },
              { value: "admin", label: "Administrador" },
            ]}
          />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" type="button" onClick={() => setAddOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>Crear usuario</Button>
          </div>
        </form>
      </Modal>

      {/* Modal — Editar usuario */}
      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title="Editar usuario"
        className="max-w-md"
      >
        {editUser && (
          <form onSubmit={handleEdit} className="space-y-4">
            <Input
              name="full_name"
              label="Nombre completo"
              required
              defaultValue={editUser.full_name}
              placeholder="Ej: Juan García"
            />
            <Input
              name="email"
              label="Correo electrónico"
              type="email"
              required
              defaultValue={editUser.email}
              placeholder="juan@empresa.com"
            />
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" type="button" onClick={() => setEditUser(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" loading={isPending}>Guardar cambios</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal — Cambiar contraseña */}
      <Modal
        open={!!pwdUser}
        onClose={() => setPwdUser(null)}
        title="Cambiar contraseña"
        className="max-w-md"
      >
        {pwdUser && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <p className="text-sm text-gray-500">
              Usuario: <span className="font-medium text-gray-900">{pwdUser.full_name}</span>
            </p>
            <Input
              name="password"
              label="Nueva contraseña"
              type="password"
              required
              placeholder="Mínimo 6 caracteres"
            />
            <Input
              name="confirm"
              label="Confirmar contraseña"
              type="password"
              required
              placeholder="Repite la contraseña"
            />
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" type="button" onClick={() => setPwdUser(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" loading={isPending}>Cambiar contraseña</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal — Confirmar eliminación */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar usuario"
        className="max-w-sm"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              ¿Estás seguro de eliminar a{" "}
              <span className="font-semibold text-gray-900">{deleteTarget.full_name}</span>?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isPending}>
                Cancelar
              </Button>
              <Button
                onClick={handleDelete}
                loading={isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Eliminar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
