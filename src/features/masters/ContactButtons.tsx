import { mailHref, orderedPeople, telHref, whatsappHref, type StepMessage } from '../../lib/contacts';
import type { Department, Person } from '../../lib/masters';

/** Call / WhatsApp / Email for one person. Messages open ready to edit; nothing is sent automatically. */
export function PersonContact({ person, message }: { person: Person; message: (p: Person) => StepMessage }) {
  const m = message(person);
  const tel = telHref(person);
  const wa = whatsappHref(person, m.body);
  const mail = mailHref(person, m.subject, m.body);
  return (
    <span className="contact-row">
      <span className="contact-name">
        {person.name}
        {person.designation && <span className="muted"> · {person.designation}</span>}
      </span>
      <span className="contact-buttons">
        {tel && (
          <a className="contact-btn" href={tel} aria-label={`Call ${person.name}`}>
            Call
          </a>
        )}
        {wa && (
          <a className="contact-btn wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${person.name}`}>
            WhatsApp
          </a>
        )}
        {mail && (
          <a className="contact-btn" href={mail} aria-label={`Email ${person.name}`}>
            Email
          </a>
        )}
        {!tel && !wa && !mail && <span className="muted small">no contact details</span>}
      </span>
    </span>
  );
}

/** Who handles this step: the department and its people (primary first; others behind "more"). */
export function StepContacts({ departments, message }: { departments: Pick<Department, 'name' | 'people'>[]; message: (p: Person) => StepMessage }) {
  if (departments.length === 0) return null;
  return (
    <div className="step-contacts">
      {departments.map((d) => {
        const people = orderedPeople(d.people);
        const [first, ...rest] = people;
        return (
          <div key={d.name} className="small">
            <span className="muted">{d.name}</span>
            {!first && <span className="muted"> · no people added</span>}
            {first && <PersonContact person={first} message={message} />}
            {rest.length > 0 && (
              <details className="more-people">
                <summary className="muted">
                  {rest.length} more {rest.length === 1 ? 'person' : 'people'}
                </summary>
                {rest.map((p, i) => (
                  <PersonContact key={`${p.name}-${i}`} person={p} message={message} />
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
