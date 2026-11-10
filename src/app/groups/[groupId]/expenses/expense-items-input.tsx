import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Locale } from '@/i18n/request'
import { Currency } from '@/lib/currency'
import { calculateItemizedSplit } from '@/lib/itemized'
import { ExpenseFormValues } from '@/lib/schemas'
import {
  enforceCurrencyPattern,
  formatCurrency,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { Check, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { useFieldArray, useFormContext } from 'react-hook-form'

export const emptyItem: ExpenseFormValues['items'][number] = {
  name: '',
  price: '' as any, // Use string to ensure consistent schema handling
  paidFor: [],
}

type Props = {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  split: ReturnType<typeof calculateItemizedSplit>
  /** The currency to convert prices from, if it is not the group currency */
  originalCurrency?: Currency
}

export function ExpenseItemsInput({ group, split, originalCurrency }: Props) {
  const t = useTranslations('ExpenseForm')
  const tErrors = useTranslations('SchemaErrors')
  const locale = useLocale() as Locale
  const groupCurrency = getCurrencyFromGroup(group)
  const form = useFormContext<ExpenseFormValues>()
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  })
  const conversionRate = Number(form.watch('conversionRate'))
  const isConverting = !!originalCurrency

  const convertPrice = (index: number, originalPrice: string) => {
    const price = Number(originalPrice) * conversionRate
    form.setValue(
      `items.${index}.price`,
      (originalPrice === '' || Number.isNaN(price)
        ? ''
        : price.toFixed(groupCurrency.decimal_digits)) as any, // Use string to ensure consistent schema handling
      { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
    )
  }

  useEffect(() => {
    if (!isConverting || !conversionRate) return
    form.getValues('items').forEach(({ originalPrice }, index) => {
      if (originalPrice) convertPrice(index, originalPrice)
    })
  }, [conversionRate, isConverting])

  return (
    <div>
      {fields.map(({ id: fieldId }, index) => (
        <div
          key={fieldId}
          className="space-y-3 border-t -mx-6 px-6 py-4"
          data-testid="expense-item"
        >
          <div className="flex flex-wrap items-start gap-2">
            <FormField
              control={form.control}
              name={`items.${index}.name`}
              render={({ field }) => (
                <FormItem className="flex-1 basis-40 space-y-0">
                  <FormLabel className="sr-only">
                    {t('itemsField.name')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('itemsField.name')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="pt-2" />
                </FormItem>
              )}
            />
            <div className="flex items-start gap-1">
              {originalCurrency && (
                <FormField
                  control={form.control}
                  name={`items.${index}.originalPrice`}
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormLabel className="sr-only">
                        {t('itemsField.originalPrice')}
                      </FormLabel>
                      <div className="flex items-center gap-1">
                        <span className="text-sm">
                          {originalCurrency.symbol}
                        </span>
                        <FormControl>
                          <Input
                            className="text-base w-[80px]"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(event) => {
                              const v = enforceCurrencyPattern(
                                event.target.value,
                              )
                              field.onChange(v)
                              convertPrice(index, v)
                            }}
                          />
                        </FormControl>
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      </div>
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name={`items.${index}.price`}
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <FormLabel className="sr-only">
                      {t('itemsField.price')}
                    </FormLabel>
                    <div className="flex items-center gap-1">
                      <span className="text-sm">{group.currency}</span>
                      <FormControl>
                        <Input
                          className="text-base w-[90px]"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          {...field}
                          onChange={(event) => {
                            field.onChange(
                              enforceCurrencyPattern(event.target.value),
                            )
                            // The price is not the result of a conversion anymore
                            form.setValue(`items.${index}.originalPrice`, '')
                          }}
                        />
                      </FormControl>
                    </div>
                    <FormMessage className="pt-2" />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t('itemsField.remove')}
                aria-label={t('itemsField.remove')}
                onClick={() => remove(index)}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          </div>
          <FormField
            control={form.control}
            name={`items.${index}.paidFor`}
            render={({ field }) => {
              const everyone = group.participants.every(({ id }) =>
                field.value.includes(id),
              )
              return (
                <FormItem>
                  <div
                    className="flex flex-wrap items-center gap-2"
                    role="group"
                    aria-label={t('itemsField.gotBy')}
                  >
                    <span className="text-sm text-muted-foreground">
                      {t('itemsField.gotBy')}
                    </span>
                    {group.participants.map(({ id, name }) => {
                      const selected = field.value.includes(id)
                      return (
                        <Toggle
                          key={id}
                          selected={selected}
                          onClick={() =>
                            field.onChange(
                              selected
                                ? field.value.filter((value) => value !== id)
                                : [...field.value, id],
                            )
                          }
                        >
                          {name}
                        </Toggle>
                      )
                    })}
                    {group.participants.length > 1 && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-8 px-1"
                        onClick={() =>
                          field.onChange(
                            everyone
                              ? []
                              : group.participants.map(({ id }) => id),
                          )
                        }
                      >
                        {everyone ? t('selectNone') : t('itemsField.everyone')}
                      </Button>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        </div>
      ))}

      <div className="border-t -mx-6 px-6 pt-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => append(emptyItem)}
        >
          <Plus className="w-4 h-4 mr-2" />
          {t('itemsField.add')}
        </Button>
        {form.formState.errors.items?.root && (
          <p className="mt-2 text-sm font-medium text-destructive">
            {tErrors('itemsMin1')}
          </p>
        )}
      </div>

      {split.paidFor.length > 0 && (
        <div className="mt-4 text-sm space-y-1" data-testid="items-summary">
          <div className="font-medium">{t('itemsField.summary')}</div>
          {group.participants.map(({ id, name }) => {
            const share = split.paidFor.find(
              ({ participant }) => participant === id,
            )
            if (!share) return null
            return (
              <div
                key={id}
                className="flex justify-between text-muted-foreground"
              >
                <span>{name}</span>
                <span className="tabular-nums">
                  {formatCurrency(groupCurrency, share.shares, locale)}
                </span>
              </div>
            )
          })}
          <div className="flex justify-between font-medium">
            <span>{t('itemsField.total')}</span>
            <span className="tabular-nums">
              {formatCurrency(groupCurrency, split.amount, locale)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={selected ? 'default' : 'outline'}
      size="sm"
      className="h-8 rounded-full"
      aria-pressed={selected}
      onClick={onClick}
    >
      {selected && <Check className="w-3 h-3 mr-1" />}
      {children}
    </Button>
  )
}
