-- ═══════════════════════════════════════════════════════════════════════
-- Trigger 1: Auto-sync registered_count on registration changes
-- Prevents count drift between categories.registered_count and actual rows
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_registered_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('CANCELLED') THEN
      UPDATE categories
      SET registered_count = registered_count + 1
      WHERE id = NEW.category_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status changed to CANCELLED: decrement
    IF OLD.status NOT IN ('CANCELLED')
       AND NEW.status IN ('CANCELLED') THEN
      UPDATE categories
      SET registered_count = registered_count - 1
      WHERE id = NEW.category_id;
    END IF;
    -- Status changed from CANCELLED: increment
    IF OLD.status IN ('CANCELLED')
       AND NEW.status NOT IN ('CANCELLED') THEN
      UPDATE categories
      SET registered_count = registered_count + 1
      WHERE id = NEW.category_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('CANCELLED') THEN
      UPDATE categories
      SET registered_count = registered_count - 1
      WHERE id = OLD.category_id;
    END IF;
  END IF;

  -- Never allow negative count
  UPDATE categories
  SET registered_count = GREATEST(registered_count, 0)
  WHERE id = COALESCE(NEW.category_id, OLD.category_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS registration_count_sync ON registrations;
CREATE TRIGGER registration_count_sync
AFTER INSERT OR UPDATE OR DELETE ON registrations
FOR EACH ROW EXECUTE FUNCTION sync_registered_count();

-- ═══════════════════════════════════════════════════════════════════════
-- Trigger 2: Enforce tournament status machine at DB level
-- Prevents invalid state transitions even from direct SQL
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_tournament_status()
RETURNS TRIGGER AS $$
DECLARE
  allowed_transitions jsonb := '{
    "DRAFT": ["PENDING_APPROVAL", "CANCELLED"],
    "PENDING_APPROVAL": ["APPROVED", "REJECTED", "CANCELLED"],
    "APPROVED": ["ACTIVE", "CANCELLED"],
    "ACTIVE": ["CLOSED", "CANCELLED"],
    "CLOSED": [],
    "CANCELLED": [],
    "REJECTED": ["DRAFT"]
  }';
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (allowed_transitions->OLD.status::text) @> to_jsonb(NEW.status::text) THEN
    RAISE EXCEPTION 'Invalid tournament status transition: % → %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournament_status_guard ON tournaments;
CREATE TRIGGER tournament_status_guard
BEFORE UPDATE ON tournaments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION validate_tournament_status();

-- ═══════════════════════════════════════════════════════════════════════
-- Recreate entry number sequence (if not exists)
-- ═══════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS entry_number_seq START 1;
