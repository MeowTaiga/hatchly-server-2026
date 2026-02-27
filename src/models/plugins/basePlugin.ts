import type { Schema } from 'mongoose';

/**
 * Mongoose plugin applied to every schema in the project.
 *
 * What it does:
 * - Enables `timestamps` (createdAt / updatedAt managed by Mongoose)
 * - Transforms `toJSON` output: renames `_id` → `id` and strips `__v`
 *
 * Usage:
 * ```ts
 * const schema = new Schema({ ... });
 * schema.plugin(basePlugin);
 * ```
 */
export function basePlugin(schema: Schema): void {
  schema.set('timestamps', true);

  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc: any, ret: Record<string, any>) {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  });

  schema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform(_doc: any, ret: Record<string, any>) {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  });
}
