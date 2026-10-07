// Registers every API route module (side-effect imports). Order matters only for overlapping patterns:
// literal paths are registered before parameterised ones inside each module.
import "./system";
import "./masters";
import "./rooms";
import "./rates";
import "./guests";
import "./reservations";
import "./frontdesk";
import "./folio";
import "./housekeeping";
import "./maintenance";
import "./ops";
import "./documents";
import "./data";
import "./pos";
