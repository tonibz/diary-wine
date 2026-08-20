export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appellations: {
        Row: {
          country: string | null
          grape_count: number | null
          grapes: Json | null
          id: string
          name: string
          norm_name: string
          region: string | null
          source: string | null
          typical_colour: string | null
          wikipedia_langs: string | null
          wikipedia_title: string | null
        }
        Insert: {
          country?: string | null
          grape_count?: number | null
          grapes?: Json | null
          id?: string
          name: string
          norm_name: string
          region?: string | null
          source?: string | null
          typical_colour?: string | null
          wikipedia_langs?: string | null
          wikipedia_title?: string | null
        }
        Update: {
          country?: string | null
          grape_count?: number | null
          grapes?: Json | null
          id?: string
          name?: string
          norm_name?: string
          region?: string | null
          source?: string | null
          typical_colour?: string | null
          wikipedia_langs?: string | null
          wikipedia_title?: string | null
        }
        Relationships: []
      }
      entries: {
        Row: {
          back_photo_url: string | null
          company: string | null
          created_at: string
          id: string
          notes: string | null
          photo_url: string | null
          place: string | null
          price_context:
            | Database["public"]["Enums"]["price_context_kind"]
            | null
          price_currency: string | null
          price_paid: number | null
          rating: number | null
          status: Database["public"]["Enums"]["entry_status"]
          tasted_on: string
          user_id: string
          wine_vintage_id: string
        }
        Insert: {
          back_photo_url?: string | null
          company?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          place?: string | null
          price_context?:
            | Database["public"]["Enums"]["price_context_kind"]
            | null
          price_currency?: string | null
          price_paid?: number | null
          rating?: number | null
          status?: Database["public"]["Enums"]["entry_status"]
          tasted_on?: string
          user_id: string
          wine_vintage_id: string
        }
        Update: {
          back_photo_url?: string | null
          company?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          place?: string | null
          price_context?:
            | Database["public"]["Enums"]["price_context_kind"]
            | null
          price_currency?: string | null
          price_paid?: number | null
          rating?: number | null
          status?: Database["public"]["Enums"]["entry_status"]
          tasted_on?: string
          user_id?: string
          wine_vintage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entries_wine_vintage_id_fkey"
            columns: ["wine_vintage_id"]
            isOneToOne: false
            referencedRelation: "wine_vintages"
            referencedColumns: ["id"]
          },
        ]
      }
      inference_checks: {
        Row: {
          agrees: boolean | null
          appellation_match_score: number | null
          appellation_matched: string | null
          created_at: string
          field: string
          id: string
          model_value: Json | null
          overlap_count: number | null
          recognition_id: string
          reference_count: number | null
          reference_value: Json | null
          user_resolved_to: string | null
        }
        Insert: {
          agrees?: boolean | null
          appellation_match_score?: number | null
          appellation_matched?: string | null
          created_at?: string
          field: string
          id?: string
          model_value?: Json | null
          overlap_count?: number | null
          recognition_id: string
          reference_count?: number | null
          reference_value?: Json | null
          user_resolved_to?: string | null
        }
        Update: {
          agrees?: boolean | null
          appellation_match_score?: number | null
          appellation_matched?: string | null
          created_at?: string
          field?: string
          id?: string
          model_value?: Json | null
          overlap_count?: number | null
          recognition_id?: string
          reference_count?: number | null
          reference_value?: Json | null
          user_resolved_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inference_checks_recognition_id_fkey"
            columns: ["recognition_id"]
            isOneToOne: false
            referencedRelation: "recognitions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_decisions: {
        Row: {
          candidate_wine_id: string | null
          created_at: string
          decision: Database["public"]["Enums"]["match_decision_kind"]
          id: string
          new_name: string
          new_producer: string | null
          new_vintage: number | null
          similarity_score: number | null
          user_id: string
        }
        Insert: {
          candidate_wine_id?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["match_decision_kind"]
          id?: string
          new_name: string
          new_producer?: string | null
          new_vintage?: number | null
          similarity_score?: number | null
          user_id: string
        }
        Update: {
          candidate_wine_id?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["match_decision_kind"]
          id?: string
          new_name?: string
          new_producer?: string | null
          new_vintage?: number | null
          similarity_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_decisions_candidate_wine_id_fkey"
            columns: ["candidate_wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          by_the_glass: boolean
          created_at: string
          currency: string | null
          glass_price: number | null
          grapes: Json | null
          id: string
          item_confidence: number | null
          match_score: number | null
          matched_wine_id: string | null
          menu_scan_id: string
          parsed_name: string | null
          parsed_producer: string | null
          parsed_vintage: number | null
          position: number | null
          price: number | null
          raw_text: string | null
          section_heading: string | null
          truncated: boolean
          wine_type: string | null
        }
        Insert: {
          by_the_glass?: boolean
          created_at?: string
          currency?: string | null
          glass_price?: number | null
          grapes?: Json | null
          id?: string
          item_confidence?: number | null
          match_score?: number | null
          matched_wine_id?: string | null
          menu_scan_id: string
          parsed_name?: string | null
          parsed_producer?: string | null
          parsed_vintage?: number | null
          position?: number | null
          price?: number | null
          raw_text?: string | null
          section_heading?: string | null
          truncated?: boolean
          wine_type?: string | null
        }
        Update: {
          by_the_glass?: boolean
          created_at?: string
          currency?: string | null
          glass_price?: number | null
          grapes?: Json | null
          id?: string
          item_confidence?: number | null
          match_score?: number | null
          matched_wine_id?: string | null
          menu_scan_id?: string
          parsed_name?: string | null
          parsed_producer?: string | null
          parsed_vintage?: number | null
          position?: number | null
          price?: number | null
          raw_text?: string | null
          section_heading?: string | null
          truncated?: boolean
          wine_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_matched_wine_id_fkey"
            columns: ["matched_wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_menu_scan_id_fkey"
            columns: ["menu_scan_id"]
            isOneToOne: false
            referencedRelation: "menu_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_scans: {
        Row: {
          created_at: string
          id: string
          photo_path: string | null
          raw_response: Json | null
          restaurant_name: string | null
          scanned_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_path?: string | null
          raw_response?: Json | null
          restaurant_name?: string | null
          scanned_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_path?: string | null
          raw_response?: Json | null
          restaurant_name?: string | null
          scanned_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          gps_lookup_enabled: boolean
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          gps_lookup_enabled?: boolean
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          gps_lookup_enabled?: boolean
          id?: string
        }
        Relationships: []
      }
      recognitions: {
        Row: {
          confidence: number | null
          corrected_fields: Json | null
          created_at: string
          entry_id: string | null
          id: string
          inferred_fields: Json | null
          model_name: string | null
          photo_path: string
          raw_response: Json | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          corrected_fields?: Json | null
          created_at?: string
          entry_id?: string | null
          id?: string
          inferred_fields?: Json | null
          model_name?: string | null
          photo_path: string
          raw_response?: Json | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          corrected_fields?: Json | null
          created_at?: string
          entry_id?: string | null
          id?: string
          inferred_fields?: Json | null
          model_name?: string | null
          photo_path?: string
          raw_response?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognitions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      taste_profiles: {
        Row: {
          avg_alcohol: number | null
          avg_vintage_age: number | null
          entry_count: number
          top_countries: Json | null
          top_grapes: Json | null
          type_split: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_alcohol?: number | null
          avg_vintage_age?: number | null
          entry_count?: number
          top_countries?: Json | null
          top_grapes?: Json | null
          type_split?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_alcohol?: number | null
          avg_vintage_age?: number | null
          entry_count?: number
          top_countries?: Json | null
          top_grapes?: Json | null
          type_split?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wine_aliases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          raw_name: string
          raw_producer: string | null
          source: Database["public"]["Enums"]["wine_data_source"]
          wine_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          raw_name: string
          raw_producer?: string | null
          source?: Database["public"]["Enums"]["wine_data_source"]
          wine_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          raw_name?: string
          raw_producer?: string | null
          source?: Database["public"]["Enums"]["wine_data_source"]
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_aliases_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_edits: {
        Row: {
          created_at: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          user_id: string
          wine_id: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id: string
          wine_id: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id?: string
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_edits_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_vintages: {
        Row: {
          alcohol_percent: number | null
          created_at: string
          id: string
          vintage: number | null
          wine_id: string
        }
        Insert: {
          alcohol_percent?: number | null
          created_at?: string
          id?: string
          vintage?: number | null
          wine_id: string
        }
        Update: {
          alcohol_percent?: number | null
          created_at?: string
          id?: string
          vintage?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_vintages_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wines: {
        Row: {
          appellation: string | null
          country: string | null
          created_at: string
          created_by: string | null
          data_source: Database["public"]["Enums"]["wine_data_source"]
          field_sources: Json
          grapes: string[] | null
          id: string
          label_image_url: string | null
          name: string
          norm_name: string | null
          norm_producer: string | null
          producer: string | null
          region: string | null
          wine_type: Database["public"]["Enums"]["wine_type"] | null
        }
        Insert: {
          appellation?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          data_source?: Database["public"]["Enums"]["wine_data_source"]
          field_sources?: Json
          grapes?: string[] | null
          id?: string
          label_image_url?: string | null
          name: string
          norm_name?: string | null
          norm_producer?: string | null
          producer?: string | null
          region?: string | null
          wine_type?: Database["public"]["Enums"]["wine_type"] | null
        }
        Update: {
          appellation?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          data_source?: Database["public"]["Enums"]["wine_data_source"]
          field_sources?: Json
          grapes?: string[] | null
          id?: string
          label_image_url?: string | null
          name?: string
          norm_name?: string | null
          norm_producer?: string | null
          producer?: string | null
          region?: string | null
          wine_type?: Database["public"]["Enums"]["wine_type"] | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_wine_match: {
        Args: { _name: string; _producer: string }
        Returns: {
          country: string
          id: string
          name: string
          producer: string
          region: string
          score: number
        }[]
      }
      find_wine_matches: {
        Args: { _names: string[]; _producers: string[] }
        Returns: {
          country: string
          id: string
          idx: number
          name: string
          producer: string
          region: string
          score: number
        }[]
      }
      lookup_appellation: {
        Args: { _name: string }
        Returns: {
          country: string
          grape_count: number
          grapes: Json
          id: string
          name: string
          region: string
          score: number
          typical_colour: string
        }[]
      }
      normalize_wine_text: { Args: { t: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      entry_status: "tasted" | "interested"
      match_decision_kind:
        | "auto_merge"
        | "user_merge"
        | "user_rejected"
        | "auto_new"
      price_context_kind: "restaurant" | "shop" | "online" | "other"
      wine_data_source: "label" | "inferred" | "user"
      wine_type:
        | "red"
        | "white"
        | "rose"
        | "sparkling"
        | "dessert"
        | "fortified"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      entry_status: ["tasted", "interested"],
      match_decision_kind: [
        "auto_merge",
        "user_merge",
        "user_rejected",
        "auto_new",
      ],
      price_context_kind: ["restaurant", "shop", "online", "other"],
      wine_data_source: ["label", "inferred", "user"],
      wine_type: ["red", "white", "rose", "sparkling", "dessert", "fortified"],
    },
  },
} as const
