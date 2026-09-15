CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(50) DEFAULT 'default' NOT NULL,
	"model_ref" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" varchar(100) NOT NULL,
	"dimensions" integer DEFAULT 1536 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"actor" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"actor_agent_id" varchar(100),
	"reason" varchar(500),
	"changed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_memories_embedding";--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "memory_key" varchar(255);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "content_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "confidence" real DEFAULT 0.8 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "explicit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "access_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_tenant" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_memory_embeddings_vector" ON "memory_embeddings" USING ivfflat ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memory_embeddings_model" ON "memory_embeddings" USING btree ("memory_id","model");--> statement-breakpoint
CREATE INDEX "idx_memory_events_memory" ON "memory_events" USING btree ("memory_id","occurred_at");--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_memories_user" ON "memories" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memories_hash" ON "memories" USING btree ("tenant_id","user_id","type","content_hash");--> statement-breakpoint
CREATE INDEX "idx_memories_key" ON "memories" USING btree ("tenant_id","user_id","memory_key");--> statement-breakpoint
ALTER TABLE "memories" DROP COLUMN "embedding";