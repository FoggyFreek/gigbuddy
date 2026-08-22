# Verify the mandate before scheduling trial continuation

Status: accepted

## Context

A free trial starts without payment details, but charging the selected Band
and/or Artist modules at the advertised trial end requires a reusable mandate.
Taking the full subscription price during the trial would contradict the trial
promise, while waiting until the end to request authorization makes continuation
unreliable.

## Decision

When a trial customer schedules paid continuation, charge a disclosed **€0.01**
`sequenceType: first` payment. Once it is authoritatively paid, store the mandate
and create the provider subscription at the quoted combined amount with
`startDate = trial_ends_at`.

The verification does not activate or extend the subscription. It remains
`trialing`; the payment row represents verification progress, so there is no
`pending_mandate` subscription status. Only the first paid scheduled recurring
charge opens the paid period and changes the subscription to `active`.

## Consequences

The customer sees €0.01 now, the later amount, and the exact charge date. Failed
verification is retryable without affecting trial access, and module selections
made during the trial reprice and replace the delayed schedule.
