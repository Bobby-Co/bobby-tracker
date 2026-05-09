
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyEthereum = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M18.8502 11.9629L12.2012 2.08488C12.1252 1.97188 11.9442 1.97188 11.8682 2.08388L5.15019 11.9619C5.09319 12.0459 5.12419 12.1549 5.21819 12.2039L11.9362 15.7379C11.9972 15.7709 12.0732 15.7699 12.1342 15.7379L18.7822 12.2039C18.8762 12.1549 18.9062 12.0459 18.8502 11.9629Z" fill={secondColor}></path>
		<path fillRule="evenodd" clipRule="evenodd" d="M18.4091 13.5284L12.1351 16.9234C12.0741 16.9564 11.9971 16.9564 11.9351 16.9234L5.59208 13.5244C5.41108 13.4264 5.21108 13.6224 5.33408 13.7774L11.8761 21.9274C11.9541 22.0244 12.1151 22.0244 12.1931 21.9264L18.6681 13.7804C18.7911 13.6254 18.5901 13.4304 18.4091 13.5284Z" fill={secondColor}></path>
		</svg>
    ) 
}