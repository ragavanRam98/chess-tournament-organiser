-- CreateEnum
CREATE TYPE "ChessResultsSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'ACTIVE', 'COMPLETED', 'ERROR', 'DISABLED');

-- CreateTable
CREATE TABLE "chess_results_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tournament_id" UUID NOT NULL,
    "category_id" UUID,
    "chess_results_server" VARCHAR(10) NOT NULL,
    "chess_results_tnr_id" VARCHAR(20) NOT NULL,
    "chess_results_url" VARCHAR(500) NOT NULL,
    "total_rounds" INTEGER,
    "last_synced_at" TIMESTAMPTZ,
    "last_synced_round" INTEGER,
    "sync_status" "ChessResultsSyncStatus" NOT NULL DEFAULT 'PENDING',
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_results_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_results_players" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "link_id" UUID NOT NULL,
    "start_number" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fide_id" VARCHAR(20),
    "rating" INTEGER,
    "federation" VARCHAR(10),
    "club" VARCHAR(255),
    "sex" VARCHAR(5),
    "registration_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_results_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_results_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "link_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMPTZ,
    "pairings" JSONB,
    "standings" JSONB,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_results_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_results_cross_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "link_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_results_cross_tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_links_category_id_key" ON "chess_results_links"("category_id");

-- CreateIndex
CREATE INDEX "idx_cr_link_tournament" ON "chess_results_links"("tournament_id");

-- CreateIndex
CREATE INDEX "idx_cr_link_sync_status" ON "chess_results_links"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_links_tournament_id_category_id_key" ON "chess_results_links"("tournament_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_players_registration_id_key" ON "chess_results_players"("registration_id");

-- CreateIndex
CREATE INDEX "idx_cr_player_link" ON "chess_results_players"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_players_link_id_start_number_key" ON "chess_results_players"("link_id", "start_number");

-- CreateIndex
CREATE INDEX "idx_cr_round_link" ON "chess_results_rounds"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_rounds_link_id_round_number_key" ON "chess_results_rounds"("link_id", "round_number");

-- CreateIndex
CREATE UNIQUE INDEX "chess_results_cross_tables_link_id_key" ON "chess_results_cross_tables"("link_id");

-- AddForeignKey
ALTER TABLE "chess_results_links" ADD CONSTRAINT "chess_results_links_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_results_links" ADD CONSTRAINT "chess_results_links_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_results_players" ADD CONSTRAINT "chess_results_players_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "chess_results_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_results_players" ADD CONSTRAINT "chess_results_players_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_results_rounds" ADD CONSTRAINT "chess_results_rounds_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "chess_results_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_results_cross_tables" ADD CONSTRAINT "chess_results_cross_tables_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "chess_results_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
