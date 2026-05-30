export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          class_id: number
          created_at: string | null
          id: string
          notes: string | null
          session_date: string
          status: string
          student_id: string
        }
        Insert: {
          class_id: number
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date: string
          status?: string
          student_id: string
        }
        Update: {
          class_id?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          airtable_id: string | null
          class_name: string | null
          day_of_week: string | null
          end_time: string | null
          id: number
          room: string | null
          start_time: string | null
          teacher: string | null
        }
        Insert: {
          airtable_id?: string | null
          class_name?: string | null
          day_of_week?: string | null
          end_time?: string | null
          id?: number
          room?: string | null
          start_time?: string | null
          teacher?: string | null
        }
        Update: {
          airtable_id?: string | null
          class_name?: string | null
          day_of_week?: string | null
          end_time?: string | null
          id?: number
          room?: string | null
          start_time?: string | null
          teacher?: string | null
        }
        Relationships: []
      }
      dropin_sessions: {
        Row: {
          created_at: string | null
          end_time: string
          id: string
          location: string | null
          notes: string | null
          session_date: string
          start_time: string
          subjects: string[] | null
          tutors: string[] | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          id?: string
          location?: string | null
          notes?: string | null
          session_date: string
          start_time: string
          subjects?: string[] | null
          tutors?: string[] | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          id?: string
          location?: string | null
          notes?: string | null
          session_date?: string
          start_time?: string
          subjects?: string[] | null
          tutors?: string[] | null
        }
        Relationships: []
      }
      dropin_signins: {
        Row: {
          id: string
          question: string | null
          session_id: string
          signed_in_at: string | null
          status: string
          student_id: string
          subject: string
        }
        Insert: {
          id?: string
          question?: string | null
          session_id: string
          signed_in_at?: string | null
          status?: string
          student_id: string
          subject: string
        }
        Update: {
          id?: string
          question?: string | null
          session_id?: string
          signed_in_at?: string | null
          status?: string
          student_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "dropin_signins_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dropin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropin_signins_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          exam_date: string | null
          id: number
          max_score: number | null
          name: string
          subject_id: number | null
        }
        Insert: {
          exam_date?: string | null
          id?: number
          max_score?: number | null
          name: string
          subject_id?: number | null
        }
        Update: {
          exam_date?: string | null
          id?: number
          max_score?: number | null
          name?: string
          subject_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_results: {
        Row: {
          airtable_id: string | null
          created_at: string | null
          homework_grade: string | null
          id: number
          max_score: number | null
          quiz_date: string | null
          score: number | null
          student_id: string | null
          subject: string | null
          week: string | null
        }
        Insert: {
          airtable_id?: string | null
          created_at?: string | null
          homework_grade?: string | null
          id?: number
          max_score?: number | null
          quiz_date?: string | null
          score?: number | null
          student_id?: string | null
          subject?: string | null
          week?: string | null
        }
        Update: {
          airtable_id?: string | null
          created_at?: string | null
          homework_grade?: string | null
          id?: number
          max_score?: number | null
          quiz_date?: string | null
          score?: number | null
          student_id?: string | null
          subject?: string | null
          week?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          created_at: string | null
          exam_id: number | null
          id: number
          score: number | null
          student_id: string | null
        }
        Insert: {
          created_at?: string | null
          exam_id?: number | null
          id?: number
          score?: number | null
          student_id?: string | null
        }
        Update: {
          created_at?: string | null
          exam_id?: number | null
          id?: number
          score?: number | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "results_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      enrolments: {
        Row: {
          class_id: number | null
          id: number
          student_id: string | null
        }
        Insert: {
          class_id?: number | null
          id?: number
          student_id?: string | null
        }
        Update: {
          class_id?: number | null
          id?: number
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrolments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          airtable_id: string | null
          email: string | null
          full_name: string | null
          id: string
          school: string | null
          school_year: string | null
          year_level: string | null
        }
        Insert: {
          airtable_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          school?: string | null
          school_year?: string | null
          year_level?: string | null
        }
        Update: {
          airtable_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          school?: string | null
          school_year?: string | null
          year_level?: string | null
        }
        Relationships: []
      }
      subjects: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      terms: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          name: string
          start_date: string
          term_number: number
          year: number
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          name: string
          start_date: string
          term_number: number
          year: number
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          name?: string
          start_date?: string
          term_number?: number
          year?: number
        }
        Relationships: []
      }
      timetable: {
        Row: {
          day_of_week: string | null
          end_time: string | null
          id: number
          location: string | null
          start_time: string | null
          student_id: string | null
          subject: string | null
        }
        Insert: {
          day_of_week?: string | null
          end_time?: string | null
          id?: number
          location?: string | null
          start_time?: string | null
          student_id?: string | null
          subject?: string | null
        }
        Update: {
          day_of_week?: string | null
          end_time?: string | null
          id?: number
          location?: string | null
          start_time?: string | null
          student_id?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timetable_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
