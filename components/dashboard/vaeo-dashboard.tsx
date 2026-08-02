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
 * VAEO — one of the two business lines (oficinas virtuales / oficinas equipadas
 * / salas de juntas, the original Business Club brand).
 *
 * The charts were cleared to be rebuilt from scratch for this client. The prop
 * surface is kept intact on purpose: `app/page.tsx` still feeds the full,
 * date-filtered dataset plus the unfiltered `all*` lookup sets, so a new chart
 * only has to be dropped in — no plumbing to redo.
 *
 * Keep the filtered / `all*` pairing when you add drill-downs: charts read the
 * date-filtered arrays, joins resolve against the unfiltered ones (a record can
 * be created outside the window that puts its counterpart on screen).
 */
export interface VaeoDashboardProps {
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

export function VaeoDashboard({
  opportunities,
  contacts,
  appointments = [],
  pautas = [],
}: VaeoDashboardProps) {
  return (
    <DashboardShell>
      <PanelPlaceholder
        brand="VAEO"
        tagline="Oficinas virtuales, oficinas equipadas y salas de juntas"
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
