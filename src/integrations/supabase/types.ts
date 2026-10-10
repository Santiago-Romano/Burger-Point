export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      menu_content: {
        Row: {
          id: number;
          items: Json;
          updated_at: string;
        };
        Insert: {
          id?: number;
          items: Json;
          updated_at?: string;
        };
        Update: {
          id?: number;
          items?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          address: string | null;
          client_order_id: string;
          created_at: string;
          customer_name: string;
          delivery_distance_meters: number | null;
          delivery_fee: number | null;
          delivery_type: string;
          id: string;
          items: Json;
          notes: string | null;
          order_number: number;
          prep_eta_minutes: number | null;
          payment: string;
          phone: string;
          status: Database["public"]["Enums"]["order_status"];
          zone: string | null;
        };
        Insert: {
          address?: string | null;
          client_order_id?: string;
          created_at?: string;
          customer_name: string;
          delivery_distance_meters?: number | null;
          delivery_fee?: number | null;
          delivery_type?: string;
          id?: string;
          items: Json;
          notes?: string | null;
          order_number?: number;
          prep_eta_minutes?: number | null;
          payment: string;
          phone: string;
          status?: Database["public"]["Enums"]["order_status"];
          zone?: string | null;
        };
        Update: {
          address?: string | null;
          client_order_id?: string;
          created_at?: string;
          customer_name?: string;
          delivery_distance_meters?: number | null;
          delivery_fee?: number | null;
          delivery_type?: string;
          id?: string;
          items?: Json;
          notes?: string | null;
          order_number?: number;
          prep_eta_minutes?: number | null;
          payment?: string;
          phone?: string;
          status?: Database["public"]["Enums"]["order_status"];
          zone?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_admin: { Args: never; Returns: boolean };
      get_admin_access_status: { Args: never; Returns: string };
      get_panel_access: { Args: never; Returns: string };
      get_order_tracking: {
        Args: { _client_order_id: string };
        Returns: { order_number: number; prep_eta_minutes: number | null; status: Database["public"]["Enums"]["order_status"] }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      list_admin_access_requests: {
        Args: never;
        Returns: { email: string | null; requested_at: string; user_id: string }[];
      };
      list_admin_access_users: {
        Args: never;
        Returns: {
          created_at: string;
          email: string | null;
          is_admin: boolean;
          request_status: string | null;
          user_id: string;
        }[];
      };
      list_access_users: {
        Args: never;
        Returns: {
          created_at: string;
          email: string | null;
          request_status: string | null;
          role: string;
          user_id: string;
        }[];
      };
      review_admin_access_request: {
        Args: { _approve: boolean; _user_id: string };
        Returns: boolean;
      };
      review_user_access_request: {
        Args: {
          _approve: boolean;
          _role: Database["public"]["Enums"]["app_role"] | null;
          _user_id: string;
        };
        Returns: boolean;
      };
      set_admin_user_access: {
        Args: { _is_admin: boolean; _user_id: string };
        Returns: boolean;
      };
      set_user_app_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"] | null;
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "operator";
      order_status: "nuevo" | "en_cocina" | "enviado" | "entregado" | "cancelado";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator"],
      order_status: ["nuevo", "en_cocina", "enviado", "entregado", "cancelado"],
    },
  },
} as const;
