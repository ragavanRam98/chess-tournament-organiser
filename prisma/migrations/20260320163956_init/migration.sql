-- CreateTable
CREATE TABLE "fide_players" (
    "fide_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "country" VARCHAR(10) NOT NULL,
    "sex" CHAR(1),
    "title" VARCHAR(10),
    "standard_rating" INTEGER,
    "rapid_rating" INTEGER,
    "blitz_rating" INTEGER,
    "birth_year" INTEGER,
    "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fide_players_pkey" PRIMARY KEY ("fide_id")
);

-- CreateIndex
CREATE INDEX "idx_fide_country" ON "fide_players"("country");
