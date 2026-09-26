```ts
const args = Bun.argv.slice(2);

if (args.length > 0) {
  $: md = 'Run', { arguments: args.join(' ') };
  console.log(md);
}

$: always = 'Always'
$: last = "Last Section";
console.log("There can be more than one", always);
console.log(last);
```
<!--$: Run -->
That's referenced inside the script
And it uses {{ arguments }}

```ts
console.log("Only if arguments were passed");
```

<!--$: Always -->
We can have multiple md blocks like this

```ts
console.log("In addition to more than one, there's more than 1 execution too");
```

<!--$: Last Section -->
## I mean, this renders nicely!
Because it's rendered with console.log in the first section
