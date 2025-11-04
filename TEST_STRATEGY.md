# Test Strategy for Confidential Vote Application

## Approach

The chosen application is a **confidential vote system**. I selected this application because it is both interesting and
realistic, allowing for a rich set of features and requiring thorough testing. I implemented several enhancements to
bring the application closer to real-world usage, including:

- Different stages of the voting process and their permitted actions.
- A reset functionality to make the contract reusable.
- Ether payment upon voter registration and withdrawal by the contract owner.

These features make the application more complex and ensure that testing is both meaningful and necessary.

## Main Risks

The critical aspects of this contract are:

- Maintaining vote privacy.
- Enforcing the rules of each stage of the voting process.
- Keeping the tally secret until the voting process is complete.
- Correctly determining the winner.

Potential risks include malicious users attempting to:

- Steal information about votes or the current tally.
- Alter results.
- Break contract rules and disrupt the process.

## Test Structure

The tests are structured based on their level, separated into **Integration** and **End-to-End (E2E)** folders. This
separation ensures:

- Clear distinction of test purposes.
- Independent development, execution, and maintenance.
- Decoupled code through the use of helper scripts for repeated logic.

Within each folder:

- Tests are grouped using `describe` blocks based on their subject.
- Helper functions are stored in a `helpers` folder to avoid duplication and keep tests clean.

## Testing at Each Level

### End-to-End (E2E)

E2E tests simulate **full user paths**, considering the client perspective. These include:

- Completing the entire voting process with all possible actions.
- Critical scenarios, such as:
  - Voting based on total participation.
  - Winner calculation.
  - Decryption of encrypted keys.
  - Reveal of the winning proposal.

### Integration

Integration tests focus on **individual components** to ensure they operate correctly according to the contract rules
and modifiers. Examples include:

- Unregistered users attempting to vote.
- Non-owner users attempting owner-only actions.
- Users trying to vote after the process has ended.

## Future Improvements

Given more time, the test suite could be extended by deploying the contract to a testnet such as **Sepolia**. This
would:

- Test the contract in a remote environment.
- Increase confidence that the smart contract behaves correctly under conditions closer to production.

## Tool Usage

During development, tools like **Copilot** and **ChatGPT** were used:

- They provided initial structure and helped accelerate development.
- Their guidance on encryption with the FHE library was limited and sometimes incorrect, requiring manual adjustments
  and problem-solving.
- Overall, the tools saved time on boilerplate but required careful validation for critical logic.
