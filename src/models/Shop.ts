import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/**
 * A shop section key used by banners and buyable items (`shopSection`).
 * The main shop is virtual (empty key) and is never stored here.
 *
 * @property key - Unique section id (e.g. 'fishing_shop')
 * @property label - Display name in admin
 * @property sortOrder - Order in the admin shop list (lower first)
 */
export interface IShop extends Document {
  key: string;
  label: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const shopSchema = new Schema<IShop>({
  key: {
    type: String,
    required: true,
    unique: true,
    match: [/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores'],
  },
  label: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
});

shopSchema.plugin(basePlugin);

export const Shop = mongoose.model<IShop>('Shop', shopSchema);
