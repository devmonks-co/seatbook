export type Role = 'ORGANIZER' | 'ATTENDEE';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface EventSummary {
  id: number;
  title: string;
  venue: string;
  startsAt: string;
  priceCents: number;
  price: string;
  totalSeats: number;
  seatsLeft: number;
}

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED';

export interface Seat {
  id: number;
  row: number;
  col: number;
  label: string;
  status: SeatStatus;
  mine: boolean;
  available: boolean;
}

export interface Hold {
  id: number;
  seatId: number;
  seatLabel: string;
  expiresAt: string;
}

export interface EventDetail extends Omit<EventSummary, 'totalSeats' | 'seatsLeft'> {
  description: string;
  hasStarted: boolean;
  rows: number;
  cols: number;
  organizer: { id: number; name: string };
  seats: Seat[];
  myHold: Hold | null;
  serverTime: string;
}

export type BookingStatus = 'HELD' | 'CONFIRMED' | 'CANCELLED';

export interface MyBooking {
  id: number;
  status: BookingStatus;
  createdAt: string;
  expiresAt: string | null;
  seat: string;
  seatId: number;
  event: { id: number; title: string; venue: string; startsAt: string; priceCents: number; price: string };
}
