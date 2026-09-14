import { TODO_ICON_OPTIONS } from "@/lib/glyphs";
import { z } from "zod";
import { accountIdSchema, objectIdSchema } from "./ids";
import { encryptedPayloadSchema, e2eeVersionSchema } from "./encryption";

const TODO_ICONS = TODO_ICON_OPTIONS;

const todoIconSchema = z.enum(TODO_ICONS);

const todoTaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_-]+$/, "Invalid task id");

const todoTaskSchema = z.object({
  id: todoTaskIdSchema,
  title: z.string().trim().min(1).max(200),
  done: z.boolean().default(false),
});

const todoListSchema = z.object({
  accountId: accountIdSchema,
  enc: e2eeVersionSchema.optional(),
  payload: encryptedPayloadSchema.optional(),
  /** Legacy plaintext fields (pre-E2EE). */
  name: z.string().trim().min(1).max(80).optional(),
  icon: todoIconSchema.optional(),
  tasks: z.array(todoTaskSchema).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createTodoListSchema = z.object({
  /** Optional client-minted id (offline write queue) — see expense.ts's `id`. */
  id: objectIdSchema.optional(),
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export const updateTodoListSchema = z.object({
  enc: e2eeVersionSchema,
  payload: encryptedPayloadSchema,
});

export type TodoList = z.infer<typeof todoListSchema>;
