# Backend Test Plan Example

This is an example of how to write a backend test plan for additional admin tests.
Rename this file to `plan.md` if you need custom backend testing beyond the defaults.

The predefined tests in `admin.spec.ts` and `content.spec.ts` cover standard Sitefinity admin functionality.
Use this plan ONLY if you need to test custom modules or specific admin scenarios.

---

## Custom modules to test

Test the "Events" custom module:
- Create a new event with title "Test Event"
- Verify it appears in the list
- Edit the event
- Delete it

## Forms module

- Go to Forms section
- Check the form responses for the Contact form
- Export responses if available

## Custom content types

If there's a "Products" content type:
- Create a product
- Add an image
- Publish it
- Verify it appears on the frontend
