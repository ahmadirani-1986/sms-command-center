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
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Relationships: []
      }
      invited_users: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
        }
        Relationships: []
      }
      sms_allowed_sender_ids: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          sender_id: string
          status: Database["public"]["Enums"]["sender_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          sender_id: string
          status?: Database["public"]["Enums"]["sender_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          sender_id?: string
          status?: Database["public"]["Enums"]["sender_status"]
          updated_at?: string
        }
        Relationships: []
      }
      sms_api_profiles: {
        Row: {
          auth_header_name: string
          auth_type: string
          base_url: string
          created_at: string
          created_by: string | null
          credential_secret_name: string
          credits_method: string
          credits_path: string
          dlr_method: string
          dlr_path: string
          id: string
          is_active: boolean
          last_credits: number | null
          last_tested_at: string | null
          name: string
          send_sms_method: string
          send_sms_path: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
          wallet_id: string | null
        }
        Insert: {
          auth_header_name?: string
          auth_type?: string
          base_url: string
          created_at?: string
          created_by?: string | null
          credential_secret_name: string
          credits_method?: string
          credits_path?: string
          dlr_method?: string
          dlr_path?: string
          id?: string
          is_active?: boolean
          last_credits?: number | null
          last_tested_at?: string | null
          name: string
          send_sms_method?: string
          send_sms_path?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          auth_header_name?: string
          auth_type?: string
          base_url?: string
          created_at?: string
          created_by?: string | null
          credential_secret_name?: string
          credits_method?: string
          credits_path?: string
          dlr_method?: string
          dlr_path?: string
          id?: string
          is_active?: boolean
          last_credits?: number | null
          last_tested_at?: string | null
          name?: string
          send_sms_method?: string
          send_sms_path?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Relationships: []
      }
      sms_sender_experiment_attempts: {
        Row: {
          api_status: string | null
          attempt_number: number
          created_at: string
          dlr_status: string | null
          experiment_id: string
          handset_sender_observed: string | null
          http_status: number | null
          id: string
          notes: string | null
          request_payload: Json | null
          response_payload: Json | null
          sender_field_key: string
          sender_id: string | null
          sms_message_id: string | null
          updated_at: string
        }
        Insert: {
          api_status?: string | null
          attempt_number: number
          created_at?: string
          dlr_status?: string | null
          experiment_id: string
          handset_sender_observed?: string | null
          http_status?: number | null
          id?: string
          notes?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          sender_field_key: string
          sender_id?: string | null
          sms_message_id?: string | null
          updated_at?: string
        }
        Update: {
          api_status?: string | null
          attempt_number?: number
          created_at?: string
          dlr_status?: string | null
          experiment_id?: string
          handset_sender_observed?: string | null
          http_status?: number | null
          id?: string
          notes?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          sender_field_key?: string
          sender_id?: string | null
          sms_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_sender_experiment_attempts_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "sms_sender_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_sender_experiments: {
        Row: {
          api_profile_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          message_body: string
          recipient_phone_normalized: string
          recipient_phone_original: string
          sender_id: string
          status: string
        }
        Insert: {
          api_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message_body: string
          recipient_phone_normalized: string
          recipient_phone_original: string
          sender_id: string
          status?: string
        }
        Update: {
          api_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message_body?: string
          recipient_phone_normalized?: string
          recipient_phone_original?: string
          sender_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_sender_experiments_api_profile_id_fkey"
            columns: ["api_profile_id"]
            isOneToOne: false
            referencedRelation: "sms_api_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_test_allowed_numbers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string | null
          phone_normalized: string
          phone_original: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          phone_normalized: string
          phone_original: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          phone_normalized?: string
          phone_original?: string
        }
        Relationships: []
      }
      sms_test_logs: {
        Row: {
          created_at: string
          event: string
          id: string
          level: string
          payload: Json | null
          test_run_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          level?: string
          payload?: Json | null
          test_run_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          level?: string
          payload?: Json | null
          test_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_test_logs_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "sms_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_test_recipients: {
        Row: {
          created_at: string
          id: string
          is_valid: boolean
          is_whitelisted: boolean
          phone_normalized: string
          phone_original: string
          test_run_id: string
          validation_error: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_valid?: boolean
          is_whitelisted?: boolean
          phone_normalized: string
          phone_original: string
          test_run_id: string
          validation_error?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_valid?: boolean
          is_whitelisted?: boolean
          phone_normalized?: string
          phone_original?: string
          test_run_id?: string
          validation_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_test_recipients_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "sms_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_test_results: {
        Row: {
          api_status: string | null
          attempt_number: number
          campaign_id: string | null
          created_at: string
          current_status: string | null
          dlr_checked_at: string | null
          dlr_code: string | null
          dlr_status: string | null
          error_code: string | null
          error_description: string | null
          http_status: number | null
          id: string
          last_error: string | null
          latency_ms: number | null
          phone_normalized: string | null
          phone_original: string | null
          received_at_utc: string | null
          recipient_id: string | null
          remarks: string | null
          report_status: string | null
          request_payload: Json | null
          response_payload: Json | null
          sms_message_id: string | null
          status: string
          status_text: string | null
          test_run_id: string
        }
        Insert: {
          api_status?: string | null
          attempt_number?: number
          campaign_id?: string | null
          created_at?: string
          current_status?: string | null
          dlr_checked_at?: string | null
          dlr_code?: string | null
          dlr_status?: string | null
          error_code?: string | null
          error_description?: string | null
          http_status?: number | null
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          phone_normalized?: string | null
          phone_original?: string | null
          received_at_utc?: string | null
          recipient_id?: string | null
          remarks?: string | null
          report_status?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          sms_message_id?: string | null
          status?: string
          status_text?: string | null
          test_run_id: string
        }
        Update: {
          api_status?: string | null
          attempt_number?: number
          campaign_id?: string | null
          created_at?: string
          current_status?: string | null
          dlr_checked_at?: string | null
          dlr_code?: string | null
          dlr_status?: string | null
          error_code?: string | null
          error_description?: string | null
          http_status?: number | null
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          phone_normalized?: string | null
          phone_original?: string | null
          received_at_utc?: string | null
          recipient_id?: string | null
          remarks?: string | null
          report_status?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          sms_message_id?: string | null
          status?: string
          status_text?: string | null
          test_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_test_results_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "sms_test_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_test_results_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "sms_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_test_runs: {
        Row: {
          api_profile_id: string | null
          auto_stop_error_rate_pct: number
          batch_size: number
          completed_at: string | null
          concurrency: number
          created_at: string
          created_by: string | null
          credits_after: number | null
          credits_before: number | null
          custom_sender_field_key: string | null
          error_rate_pct: number
          failed_count: number
          id: string
          kill_switch: boolean
          max_send_limit: number
          message_body: string
          mode: Database["public"]["Enums"]["test_mode"]
          name: string
          pending_count: number
          ramp_up_seconds: number
          requests_per_sec: number
          retry_count: number
          sender_field_key: string
          sender_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["test_run_status"]
          submitted_count: number
          success_count: number
          timeout_seconds: number
          total_recipients: number
        }
        Insert: {
          api_profile_id?: string | null
          auto_stop_error_rate_pct?: number
          batch_size?: number
          completed_at?: string | null
          concurrency?: number
          created_at?: string
          created_by?: string | null
          credits_after?: number | null
          credits_before?: number | null
          custom_sender_field_key?: string | null
          error_rate_pct?: number
          failed_count?: number
          id?: string
          kill_switch?: boolean
          max_send_limit?: number
          message_body: string
          mode?: Database["public"]["Enums"]["test_mode"]
          name: string
          pending_count?: number
          ramp_up_seconds?: number
          requests_per_sec?: number
          retry_count?: number
          sender_field_key?: string
          sender_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["test_run_status"]
          submitted_count?: number
          success_count?: number
          timeout_seconds?: number
          total_recipients?: number
        }
        Update: {
          api_profile_id?: string | null
          auto_stop_error_rate_pct?: number
          batch_size?: number
          completed_at?: string | null
          concurrency?: number
          created_at?: string
          created_by?: string | null
          credits_after?: number | null
          credits_before?: number | null
          custom_sender_field_key?: string | null
          error_rate_pct?: number
          failed_count?: number
          id?: string
          kill_switch?: boolean
          max_send_limit?: number
          message_body?: string
          mode?: Database["public"]["Enums"]["test_mode"]
          name?: string
          pending_count?: number
          ramp_up_seconds?: number
          requests_per_sec?: number
          retry_count?: number
          sender_field_key?: string
          sender_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["test_run_status"]
          submitted_count?: number
          success_count?: number
          timeout_seconds?: number
          total_recipients?: number
        }
        Relationships: [
          {
            foreignKeyName: "sms_test_runs_api_profile_id_fkey"
            columns: ["api_profile_id"]
            isOneToOne: false
            referencedRelation: "sms_api_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
      sender_status: "active" | "inactive" | "pending"
      test_mode: "dry_run" | "real" | "load_test"
      test_run_status:
        | "draft"
        | "pending"
        | "running"
        | "completed"
        | "stopped"
        | "failed"
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
      app_role: ["admin", "operator", "viewer"],
      sender_status: ["active", "inactive", "pending"],
      test_mode: ["dry_run", "real", "load_test"],
      test_run_status: [
        "draft",
        "pending",
        "running",
        "completed",
        "stopped",
        "failed",
      ],
    },
  },
} as const
