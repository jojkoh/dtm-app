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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      boq_items: {
        Row: {
          approval_status: string
          confidence: number | null
          created_at: string
          description: string
          drawing_id: string | null
          id: string
          item_no: number | null
          project_id: string
          quantity: number
          rate: number | null
          remarks: string | null
          source: string
          specification: string | null
          system: string | null
          trade: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          confidence?: number | null
          created_at?: string
          description: string
          drawing_id?: string | null
          id?: string
          item_no?: number | null
          project_id: string
          quantity?: number
          rate?: number | null
          remarks?: string | null
          source?: string
          specification?: string | null
          system?: string | null
          trade?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          confidence?: number | null
          created_at?: string
          description?: string
          drawing_id?: string | null
          id?: string
          item_no?: number | null
          project_id?: string
          quantity?: number
          rate?: number | null
          remarks?: string | null
          source?: string
          specification?: string | null
          system?: string | null
          trade?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "uploaded_drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_availability: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          note: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          note?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          note?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_submissions: {
        Row: {
          ai_summary: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
          work_update: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          work_update: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          work_update?: string
        }
        Relationships: []
      }
      deployment_template_workers: {
        Row: {
          template_id: string
          worker_id: string
        }
        Insert: {
          template_id: string
          worker_id: string
        }
        Update: {
          template_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_template_workers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "deployment_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployment_template_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_templates: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          project_id: string | null
          recurrence: string
          remarks: string | null
          reporting_time: string | null
          return_time: string | null
          start_date: string
          trade_manager_id: string
          updated_at: string
          weekday_mask: number
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          project_id?: string | null
          recurrence?: string
          remarks?: string | null
          reporting_time?: string | null
          return_time?: string | null
          start_date?: string
          trade_manager_id: string
          updated_at?: string
          weekday_mask?: number
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string | null
          recurrence?: string
          remarks?: string | null
          reporting_time?: string | null
          return_time?: string | null
          start_date?: string
          trade_manager_id?: string
          updated_at?: string
          weekday_mask?: number
        }
        Relationships: [
          {
            foreignKeyName: "deployment_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_workers: {
        Row: {
          deployment_id: string
          id: string
          worker_id: string
        }
        Insert: {
          deployment_id: string
          id?: string
          worker_id: string
        }
        Update: {
          deployment_id?: string
          id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_workers_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployment_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      deployments: {
        Row: {
          created_at: string
          deployment_date: string
          deployment_status: string
          id: string
          project_id: string | null
          remarks: string | null
          reporting_time: string | null
          return_time: string | null
          source: string
          template_id: string | null
          trade_manager_id: string
        }
        Insert: {
          created_at?: string
          deployment_date: string
          deployment_status?: string
          id?: string
          project_id?: string | null
          remarks?: string | null
          reporting_time?: string | null
          return_time?: string | null
          source?: string
          template_id?: string | null
          trade_manager_id: string
        }
        Update: {
          created_at?: string
          deployment_date?: string
          deployment_status?: string
          id?: string
          project_id?: string | null
          remarks?: string | null
          reporting_time?: string | null
          return_time?: string | null
          source?: string
          template_id?: string | null
          trade_manager_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "deployment_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatches: {
        Row: {
          created_at: string
          created_by: string
          dispatch_date: string
          id: string
          notes: string | null
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dispatch_date: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dispatch_date?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          active_status: boolean
          created_at: string
          current_vehicle_id: string | null
          driver_name: string
          id: string
          phone: string | null
          user_id: string | null
        }
        Insert: {
          active_status?: boolean
          created_at?: string
          current_vehicle_id?: string | null
          driver_name: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          active_status?: boolean
          created_at?: string
          current_vehicle_id?: string | null
          driver_name?: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_current_vehicle_id_fkey"
            columns: ["current_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      module_permissions: {
        Row: {
          is_live: boolean
          module_name: string
          updated_at: string
        }
        Insert: {
          is_live?: boolean
          module_name: string
          updated_at?: string
        }
        Update: {
          is_live?: boolean
          module_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          is_operational: boolean
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          is_operational?: boolean
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_operational?: boolean
        }
        Relationships: []
      }
      projects: {
        Row: {
          client: string | null
          created_at: string
          description: string | null
          id: string
          location: string | null
          name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          client?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location?: string | null
          name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          client?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location?: string | null
          name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_recipients: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      trip_workers: {
        Row: {
          id: string
          trip_id: string
          worker_id: string
        }
        Insert: {
          id?: string
          trip_id: string
          worker_id: string
        }
        Update: {
          id?: string
          trip_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_workers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          departure_time: string | null
          deployment_id: string
          dispatch_id: string | null
          driver_id: string | null
          estimated_return_time: string | null
          id: string
          remarks: string | null
          trip_status: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          departure_time?: string | null
          deployment_id: string
          dispatch_id?: string | null
          driver_id?: string | null
          estimated_return_time?: string | null
          id?: string
          remarks?: string | null
          trip_status?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          departure_time?: string | null
          deployment_id?: string
          dispatch_id?: string | null
          driver_id?: string | null
          estimated_return_time?: string | null
          id?: string
          remarks?: string | null
          trip_status?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      uploaded_drawings: {
        Row: {
          ai_result: Json | null
          ai_status: string
          created_at: string
          drawing_type: string | null
          file_name: string
          id: string
          project_id: string
          scale: string | null
          storage_path: string
          trade: string | null
          uploaded_by: string
        }
        Insert: {
          ai_result?: Json | null
          ai_status?: string
          created_at?: string
          drawing_type?: string | null
          file_name: string
          id?: string
          project_id: string
          scale?: string | null
          storage_path: string
          trade?: string | null
          uploaded_by: string
        }
        Update: {
          ai_result?: Json | null
          ai_status?: string
          created_at?: string
          drawing_type?: string | null
          file_name?: string
          id?: string
          project_id?: string
          scale?: string | null
          storage_path?: string
          trade?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      vehicles: {
        Row: {
          created_at: string
          id: string
          passenger_capacity: number
          vehicle_name: string
          vehicle_plate: string
          vehicle_status: string
          vehicle_type: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          passenger_capacity?: number
          vehicle_name: string
          vehicle_plate: string
          vehicle_status?: string
          vehicle_type?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          passenger_capacity?: number
          vehicle_name?: string
          vehicle_plate?: string
          vehicle_status?: string
          vehicle_type?: string | null
        }
        Relationships: []
      }
      workers: {
        Row: {
          active_status: boolean
          created_at: string
          dormitory_block: string | null
          id: string
          phone: string | null
          trade: string | null
          user_id: string | null
          worker_name: string
          worker_type: string
        }
        Insert: {
          active_status?: boolean
          created_at?: string
          dormitory_block?: string | null
          id?: string
          phone?: string | null
          trade?: string | null
          user_id?: string | null
          worker_name: string
          worker_type?: string
        }
        Update: {
          active_status?: boolean
          created_at?: string
          dormitory_block?: string | null
          id?: string
          phone?: string | null
          trade?: string | null
          user_id?: string | null
          worker_name?: string
          worker_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_daily_submissions: { Args: never; Returns: undefined }
      generate_deployments_from_templates: {
        Args: { target_date: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      revert_dispatch_to_draft_for_dep: {
        Args: { dep_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "general_user"
        | "trade_manager"
        | "transport_hub"
        | "driver"
        | "worker"
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
      app_role: [
        "admin",
        "general_user",
        "trade_manager",
        "transport_hub",
        "driver",
        "worker",
      ],
    },
  },
} as const
