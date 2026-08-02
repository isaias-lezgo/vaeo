"use client"

import type {
  Opportunity,
  Contact,
  Pauta,
  Task,
  Call,
  Appointment,
  Pipeline,
  Message,
} from "@/lib/types"
import { DashboardShell, PanelPlaceholder } from "./dashboard-ui"

/**
 * MESH — the second business line: the coworking brand under Grupo VAEO
 * (private offices, coworking floor, meeting rooms; Monterrey).
 *
 * Same contract as the VAEO panel: charts were cleared to be rebuilt, but the
 * prop surface is kept so `app/page.tsx` keeps feeding the date-filtered
 * dataset plus the unfiltered `all*` lookup sets.
 *
 * Keep the filtered / `all*` pairing when you add drill-downs: charts read the
 * date-filtered arrays, joins resolve against the unfiltered ones (a record can
 * be created outside the window that puts its counterpart on screen).
 */
export interface MeshDashboardProps {
  opportunities: Opportunity[]
  /** Unfiltered opportunities — lookup table for drill-down joins. */
  allOpportunities?: Opportunity[]
  contacts: Contact[]
  /** Unfiltered contacts — lookup table for drill-down joins. */
  allContacts?: Contact[]
  pautas?: Pauta[]
  /** Unfiltered pautas — needed for per-contact history ranking. */
  allPautas?: Pauta[]
  pipelines?: Pipeline[]
  tasks?: Task[]
  calls?: Call[]
  messages?: Message[]
  /** Unfiltered messages — lookup table for conversation drawers. */
  allMessages?: Message[]
  appointments?: Appointment[]
  /** Unfiltered appointments — lookup table for the "Citas" drawer. */
  allAppointments?: Appointment[]
  members?: string[]
  locationId?: string
  /** Sub-account name, used in an exported report's filename. */
  locationName?: string
  /** Human label of the active date filter, for report covers. */
  periodLabel?: string
}

export function MeshDashboard({
  opportunities,
  contacts,
  appointments = [],
  pautas = [],
}: MeshDashboardProps) {
  return (
    <DashboardShell>
      <PanelPlaceholder
        brand="MESH"
        tagline="Coworking, oficinas privadas y salas de reuniones"
        counts={[
          { label: "contactos", value: contacts.length },
          { label: "oportunidades", value: opportunities.length },
          { label: "citas", value: appointments.length },
          { label: "pautas", value: pautas.length },
        ]}
      />
    </DashboardShell>
  )
}
