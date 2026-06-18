export type MembershipStatus = 'pending' | 'approved' | 'rejected';
export type OrderStatus = 'pooling' | 'ordered' | 'shipped' | 'delivered' | 'completed';

export interface User {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string;
  location_area: string;
  created_at: string;
  status?: 'pending' | 'approved' | 'rejected';
  updatedAt?: string;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  location_area: string;
  admin_id?: string;
  admin_uid?: string;
  whatsapp_link: string;
  created_at: string;
  admin?: User;
  member_count?: number;
  members?: string[];
}

export interface Membership {
  id: string;
  user_id: string;
  community_id: string;
  status: MembershipStatus;
  created_at: string;
  updatedAt?: string;
  user?: User;
  community?: Community;
}

export interface Vendor {
  id: string;
  name: string;
  contact_info: string;
  rating: number;
  created_at: string;
}

export interface Product {
  id: string;
  vendor_id?: string;
  name: string;
  description: string;
  wholesale_price: number;
  retail_price: number;
  image_url: string;
  weight: string;
  rating?: number;
  created_at?: string;
  vendor?: Vendor;
}

export interface Order {
  id: string;
  community_id: string;
  product_id: string;
  total_kg_required: number;
  total_kg_committed: number;
  status: OrderStatus;
  delivery_otp: string;
  created_at: string;
  product?: Product;
  community?: Community;
}

export interface Contribution {
  id: string;
  order_id: string;
  user_id: string;
  kg_committed: number;
  amount_paid: number;
  created_at: string;
  order?: Order;
  user?: User;
}
